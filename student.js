import { trainNearestNeighbor, trainNeuralNetwork, evaluateHeldOutAccuracy, createTrainingSamples, invalidateExperiment, hogFromGray, trainBigramLanguageModel, BIGRAM_CORPUS_CANDIDATES, BIGRAM_CORPUS_OPTIONS, BIGRAM_BENCHMARK, evaluateBigramBenchmark, invalidateLanguageExperiment, navigateLesson } from './models.js';
import { photos, categories, categoryName, trainingCandidates, heldOutPhotos } from './dataset.js';
import { imageResult, languageResult, newAttemptId, resolveSessionId } from './result-records.js';
import { createResultSync } from './result-sync.js';
import { SURVEY_QUESTIONS, surveyResult } from './survey.js';

const $ = (selector) => document.querySelector(selector);
const categorySingular = { dog: 'Dog', cat: 'Cat', bird: 'Bird', vehicle: 'Vehicle' };
const sizeOptions = [8,12,16];
const steps = [
  // The one process map of the lesson. teacher.js uses the same six steps with the same words.
  ['Collect & label','Choose example photos and their groups.'],['Measure','Record the same image patterns as numbers.'],
  ['Train','Fit a model to the chosen examples.'],['Infer','Ask the trained model for a new photo’s group.'],
  ['Evaluate','Compare guesses with known groups on held-out photos.'],['Apply','Use predictions in the photo search tool.'],
];
const matchItems = [
  {id:'choose',text:'Pick photos and attach Dogs, Cats, Birds, or Vehicles.',answer:'data',why:'These examples and labels become the chosen training data.'},
  {id:'measure',text:'Record the same 128 edge measurements for each image.',answer:'measure',why:'The browser computes fixed HOG features for every photo.'},
  {id:'nearest',text:'Store labeled measurements so nearby examples can vote.',answer:'training',why:'The nearest-neighbor model keeps the selected examples and labels.'},
  {id:'weights',text:'Adjust a network’s internal numbers using the labels.',answer:'training',why:'Training updates the network weights from the selected examples.'},
  {id:'guess',text:'Ask the trained model for the group of one new photo.',answer:'inference',why:'Inference means using a trained model to make a prediction.'},
  {id:'compare',text:'Compare guesses with known groups on photos kept out of training.',answer:'evaluation',why:'Evaluation counts correct predictions on held-out photos.'},
  {id:'filter',text:'Show photos the model predicts belong to one selected group.',answer:'application',why:'The app uses predictions to filter its photo collection.'},
];
const matchStages = [
  ['data','Collect & label'],['measure','Measure'],['training','Train'],['inference','Inference'],
  ['evaluation','Evaluate'],['application','Apply'],
];
// One training label is deliberately wrong at the start, so "Check the labels" is a real task:
// the black dog is labeled Cats. It is in every set size (8, 12 and 16 photos).
const PLANTED_WRONG_LABEL={id:'dog-black',label:'cat'};
const initialCorpusSets=Object.fromEntries(BIGRAM_CORPUS_OPTIONS.map(n=>[n,BIGRAM_CORPUS_CANDIDATES.slice(0,n).join('\n')]));
const state = {
  page:0, survey:{}, surveyAttempt:null, size:8, selected:new Set(trainingCandidates.filter((_,i)=>i<8).map(p=>p.id)),
  labels:{...Object.fromEntries(trainingCandidates.map(p=>[p.id,p.truth])),[PLANTED_WRONG_LABEL.id]:PLANTED_WRONG_LABEL.label},previousScores:null, inspected:new Set(),
  classical:null, classicalPhoto:heldOutPhotos[0].id, classicalPeek:false, classicalChoice:'', classicalResult:null,
  neural:null, networkBefore:null, networkError:'', scores:null, reportModel:'neural', reportNote:'', resultFullscreen:false,
  lmCorpusSize:8, lmCorpusSets:initialCorpusSets, lmExamples:initialCorpusSets[8], lmTrainingCount:0,
  lmModel:null, lmResults:[], lmGenerated:'', lmRan:false, lmEvaluation:null, lmEvaluationIndex:0, lmError:'', lmInvalidated:false, lmFullscreen:false,
  languageChoice:'', languageFeedback:'', languageChecked:false,
  appModel:'classical', appCategory:'bird', appSearched:false,
  matches:{}, matchActive:'', matchFeedback:{}, reflection:'',
  loadErrors:[], loading:true, modelError:'', invalidated:false, labelRevision:0,
  imageAttempt:null, languageAttempt:null,
};
// Results are saved in the background; saving never blocks or breaks the lesson.
const tabStorage=(()=>{try{return window.sessionStorage}catch{return null}})();
const resultSync=createResultSync({sessionId:resolveSessionId(location.search,tabStorage),element:$('#save-status')});
function saveResult(id,build){try{resultSync.save(id,build())}catch(e){console.warn('Lesson result not saved:',e.message)}}
// Screen order. Survey first, then one full image cycle (data → models → test → fix → app →
// matching), then the separate text experiment, which the teacher may skip, then the summary.
const pageOrder=[...SURVEY_QUESTIONS.map(q=>'survey-'+q.id),'challenge','size','labels','measure','classifier','network','evaluation','result','app','match','languageStart','languageEvidence','languageEdit','languageExplore','languageEvaluation','languageResult','reflection'];
const pageCount=pageOrder.length;
const pages=Object.fromEntries(pageOrder.map((name,i)=>[name,i]));
const esc=(value)=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function img(photo,extra=''){return '<img class="photo '+extra+'" src="'+esc(photo.src)+'" alt="'+esc(photo.name)+'">'}
function heading(text,sub=''){return '<header class="lab-heading"><h1>'+text+'</h1>'+(sub?'<p>'+sub+'</p>':'')+'</header>'}
function loadMessage(){if(state.loading)return '<p class="load-message" role="status">Preparing photos…</p>';if(state.loadErrors.length)return '<p class="error-message" role="alert">A photo could not load. Check the local photos folder.</p>';return ''}
function screenSurvey(question,index){
  const options=question.options.map(([id,label])=>'<button type="button" class="survey-option" data-survey-question="'+question.id+'" data-survey-answer="'+id+'" aria-pressed="'+(state.survey[question.id]===id)+'">'+esc(label)+'</button>').join('');
  return '<section class="lab-screen survey-screen">'+heading(esc(question.text),'Question '+(index+1)+' of '+SURVEY_QUESTIONS.length+' · anonymous, no names')+'<div class="survey-options" role="group" aria-label="'+esc(question.text)+'">'+options+'</div></section>';
}
function screenChallenge(){return '<section class="lab-screen challenge-screen">'+(state.surveyAttempt?'<p class="survey-thanks" role="status">Thank you. Your answers were sent anonymously. Wait for your teacher, then press Start.</p>':'')+heading('How can we teach a computer to recognize a dog?')+'<figure class="challenge-photo">'+img(trainingCandidates[0])+'</figure><p class="key-explanation">Choose your own examples, train two models, then check them on the same unseen photos.</p><button class="btn primary" data-action="begin">Start</button>'+loadMessage()+'</section>'}
function screenDataset(){
  const options=sizeOptions.map(n=>'<button type="button" class="size-option" data-size="'+n+'" aria-pressed="'+(state.size===n)+'"><strong>'+n+'</strong><span>photos</span><small>'+(n/categories.length)+' of each group</small></button>').join('');
  return '<section class="lab-screen dataset-screen">'+heading('How many photos will your model learn from?','Every set has the same number of dogs, cats, birds and vehicles.')+'<div class="size-options" role="group" aria-label="Training set size">'+options+'</div>'+(state.invalidated?'<p class="inline-feedback" role="status">A new choice clears the old models and test results. You will train and test again.</p>':'')+loadMessage()+'</section>';
}
function screenLabels(){
  const cards=selectedPhotos().map(p=>'<figure class="label-card">'+img(p)+'<figcaption><span>'+esc(p.name)+'</span><select data-label-for="'+p.id+'" aria-label="Label for '+esc(p.name)+'">'+categories.map(c=>'<option value="'+c+'" '+(state.labels[p.id]===c?'selected':'')+'>'+categoryName[c]+'</option>').join('')+'</select></figcaption></figure>').join('');
  return '<section class="lab-screen labels-screen">'+heading('Check the labels','Each label is the answer the model learns from. A wrong label teaches a wrong answer. Fix any label that is wrong.')+'<div class="label-grid">'+cards+'</div>'+(state.invalidated?'<p class="inline-feedback" role="status">Your edit cleared the old models and test results. Train and test again.</p>':'')+(state.previousScores?'<button class="btn primary" data-action="retrain-test" '+(!canTrain()?'disabled':'')+'>Retrain both models and test</button>':'<button class="btn primary" data-action="continue-data" '+(!canTrain()?'disabled':'')+'>Use these labels</button>')+loadMessage()+'</section>';
}
function selectedPhotos(){return trainingCandidates.filter(p=>state.selected.has(p.id))}
function screenMeasure(){
  const chosen=selectedPhotos(),p=chosen[0]||trainingCandidates[0],sample=p.feature?.slice(0,32)||Array(32).fill(0),max=Math.max(...sample,.001);
  return '<section class="lab-screen measure-screen">'+heading('Turn the chosen photos into measurements','The same fixed HOG recipe records 128 edge patterns for every image.')+'<div class="measure-demo"><figure>'+img(p)+'</figure><span aria-hidden="true">→</span><div class="edge-pattern" role="img" aria-label="Real edge measurements calculated from this photo">'+sample.map(v=>'<i style="--height:'+Math.round(10+v/max*34)+'px"></i>').join('')+'</div></div><p class="key-explanation">You will train two different models on these same numbers. Model A compares a new photo with your examples. Model B learns weights from them.</p><button class="btn primary" data-action="train-classical" '+(!canTrain()?'disabled':'')+'>Train model A</button>'+loadMessage()+(state.modelError?'<p class="error-message" role="alert">'+esc(state.modelError)+'</p>':'')+'</section>';
}
function nearestExamples(photo){return selectedPhotos().map(example=>({photo:example,label:state.labels[example.id],distance:example.feature.reduce((sum,v,i)=>sum+(v-photo.feature[i])**2,0)})).sort((a,b)=>a.distance-b.distance).slice(0,3)}
function screenClassifier(){
  const photo=heldOutPhotos.find(p=>p.id===state.classicalPhoto)||heldOutPhotos[0],neighbors=nearestExamples(photo);
  return '<section class="lab-screen classifier-screen">'+heading('Model A · Nearest neighbor','It keeps your labeled examples. For a new photo, the 3 most similar examples vote. This is a prediction, not yet a test.')+'<div class="classifier-layout"><figure class="new-example">'+img(photo)+'<figcaption>'+esc(photo.name)+'</figcaption></figure><div class="classifier-action"><label for="classical-photo">Unseen photo</label><select id="classical-photo">'+heldOutPhotos.map(p=>'<option value="'+p.id+'" '+(p.id===photo.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select><button type="button" class="btn ghost" data-action="show-neighbors">Show closest examples</button>'+(state.classicalPeek?'<div class="neighbor-row">'+neighbors.map(n=>'<figure>'+img(n.photo)+'<figcaption>'+categoryName[n.label]+'</figcaption></figure>').join('')+'</div>':'')+(state.classicalResult?'<div class="response-feedback" role="status"><strong>Model prediction: '+categoryName[state.classicalResult.prediction]+'</strong><p>'+neighbors.filter(n=>n.label===state.classicalResult.prediction).length+' of the three closest labels vote for this group.</p></div>':'<button class="btn primary" data-action="reveal-classifier">Show model prediction</button>')+'</div></div></section>';
}
function screenNetwork(){
  const example=selectedPhotos()[0]||trainingCandidates[0];
  if(!state.networkBefore&&canTrain())state.networkBefore=trainNeuralNetwork(trainingSamples(),{seed:1,epochs:0});
  const before=state.networkBefore?categoryName[state.networkBefore.predict(example.feature)]:'…',after=state.neural?categoryName[state.neural.predict(example.feature)]:'';
  return '<section class="lab-screen network-screen">'+heading('Model B · Neural network','Same photos and labels. It does not keep the examples: training adjusts its weights until your examples point to their labels.')+'<div class="network-layout"><figure>'+img(example)+'<figcaption>Label: '+categoryName[state.labels[example.id]]+'</figcaption></figure><div class="network-results"><article><b>Before training</b><strong>'+before+'</strong></article>'+(state.neural?'<article class="after-training"><b>After training</b><strong>'+after+'</strong><span>Training loss: '+state.networkBefore.lossBefore.toFixed(3)+' → '+state.neural.lossAfter.toFixed(3)+'</span><small>Loss describes training examples. It is not test accuracy.</small></article>':'')+'</div></div>'+(state.neural?'<p class="key-explanation">Training changed the network’s weights using your selected photos and labels. Next, both models use the same unseen photos.</p>':'<button class="btn primary" data-action="train-neural">Train model B</button>')+(state.networkError?'<p class="error-message" role="alert">'+esc(state.networkError)+'</p>':'')+'</section>';
}
function accuracy(model){return evaluateHeldOutAccuracy(model,heldOutPhotos)}
function screenEvaluation(){
  const results=state.scores?'<div class="score-comparison" role="status">'+[['classical','Model A · Nearest neighbor'],['neural','Model B · Neural network']].map(([key,name])=>{const s=state.scores[key];return '<article><b>'+name+'</b><strong>'+s.correct+' / '+s.total+'</strong><span>'+s.percent.toFixed(1)+'% correct on these photos</span></article>'}).join('')+'</div><p class="evaluation-caveat">Both models saw the same 12 held-out photos. This is a rough estimate from a small set.</p>':'<div class="test-photo-strip">'+heldOutPhotos.map(p=>'<figure>'+img(p)+'<figcaption>'+categoryName[p.truth]+'</figcaption></figure>').join('')+'</div><button class="btn primary" data-action="evaluate" '+(!state.classical||!state.neural?'disabled':'')+'>Test both models on 12 new photos</button>';
  return '<section class="lab-screen evaluation-screen">'+heading('Check both models on new photos','These 12 photos have never been used for training.')+results+'</section>';
}
function selectedScore(){return state.scores?.[state.reportModel]}
function shareExample(){const s=selectedScore();if(!s)return null;return s.results.find(x=>!x.correct)||s.results.find(x=>x.correct)}
function screenResult(){
  const score=selectedScore(),example=shareExample();
  if(!score)return '<section class="lab-screen">'+heading('My experiment')+'<p class="key-explanation">Train both models and test them on the unseen photos to create your result card.</p></section>';
  const exampleText=example?esc(heldOutPhotos.find(p=>p.id===example.id).name)+': known group '+categoryName[example.truth]+', predicted '+categoryName[example.prediction]+(example.correct?' — correct.':' — not correct.'):'No prediction is available.';
  return '<section class="lab-screen result-screen"><div class="result-card '+(state.resultFullscreen?'presentation-mode':'')+'"><header><span>MY AI EXPERIMENT</span><button type="button" class="text-button" data-action="fullscreen">'+(state.resultFullscreen?'Exit presentation':'Show card large')+'</button></header><div class="result-summary"><div><small>Training photos</small><strong>'+selectedPhotos().length+'</strong></div><div><small>Model</small><strong>'+ (state.reportModel==='neural'?'Neural network':'Nearest neighbor')+'</strong></div></div><div class="result-accuracy"><small>New photos correctly classified</small><strong>'+score.correct+' / '+score.total+'</strong><span>'+score.percent.toFixed(1)+'% accuracy</span>'+(state.previousScores?'<small class="before-fix">Before your change: '+state.previousScores[state.reportModel].correct+' / '+state.previousScores[state.reportModel].total+'</small>':'')+'</div><p class="result-example"><b>One test photo</b><span>'+exampleText+'</span></p><label class="reflection-field">What did you notice? <textarea id="report-note" rows="2" maxlength="150" placeholder="I noticed…">'+esc(state.reportNote)+'</textarea></label><p class="accuracy-note">More examples do not always improve a result. This small test set gives a rough estimate.</p></div><div class="report-model-choice" role="group" aria-label="Choose the model shown on your card"><span>Show on my card</span><button type="button" data-report-model="classical" aria-pressed="'+(state.reportModel==='classical')+'">Nearest neighbor</button><button type="button" data-report-model="neural" aria-pressed="'+(state.reportModel==='neural')+'">Neural network</button></div><div class="result-actions"><button class="btn ghost" data-action="revise">Check my labels</button><button class="btn primary" data-action="continue-to-app">Continue</button></div></section>';
}
function screenLanguageStart(){return '<section class="lab-screen language-start">'+heading('What word might come next?')+'<p class="sentence-prompt">a bird <span>___</span></p><p class="key-explanation">A separate, shorter experiment: a model for words, not photos.</p><div class="result-actions"><button class="btn primary" data-action="show-language-examples">See the sentences</button><button class="btn ghost" data-action="skip-language">Skip to the summary</button></div></section>'}
function screenLanguageEvidence(){return '<section class="lab-screen language-evidence">'+heading('Use the examples to choose a word')+'<div class="sentence-list"><span>a bird flies</span><span>a bird swims</span><span>a bird sings</span><span>a bird swims</span></div><p class="question-line">After “a bird”, which word appears most often?</p><div class="word-choices">'+['swims','flies','sings'].map(w=>'<button class="choice-button" data-language-choice="'+w+'">'+w+'</button>').join('')+'</div>'+(state.languageChecked?'<div class="response-feedback" role="status"><strong>'+state.languageFeedback+'</strong><p>swims: 2 · flies: 1 · sings: 1</p><p>This word model is a separate experiment from the photo classifier.</p></div>':'')+'</section>'}
function screenLanguageEdit(){
  const lines=state.lmExamples.split(/\n+/).map(x=>x.trim()).filter(Boolean).length;
  return '<section class="lab-screen language-edit">'+heading('Choose training examples','The model learns which words tend to follow each other.')+'<div class="language-size-choice" role="group" aria-label="Training corpus size">'+BIGRAM_CORPUS_OPTIONS.map(n=>'<button type="button" data-language-size="'+n+'" aria-pressed="'+(state.lmCorpusSize===n)+'">'+n+' sentences</button>').join('')+'</div><p class="language-line-count"><strong id="language-line-count">'+lines+' / '+state.lmCorpusSize+' sentences</strong></p><label class="corpus-control" for="lm-examples">Edit the examples if you like</label><textarea id="lm-examples" rows="6" spellcheck="false">'+esc(state.lmExamples)+'</textarea><p class="language-prompt">Keep one sentence on each line.</p><p id="language-invalidation" class="language-invalidation" role="status" '+(!state.lmInvalidated?'hidden':'')+'>Training data changed. The old evaluation is cleared; train and test again.</p>'+(state.lmError?'<p class="error-message" role="alert">'+esc(state.lmError)+'</p>':'')+'<button class="btn primary" data-action="run-language" '+(lines!==state.lmCorpusSize?'disabled':'')+'>Train this model</button></section>';
}
function screenLanguageExplore(){
  const top=state.lmResults[0],total=state.lmResults.reduce((sum,item)=>sum+item.count,0);
  const generated=state.lmGenerated?'<div class="language-generated" role="status"><b>Generated text</b><span>'+esc(state.lmGenerated)+'</span></div>':'';
  return '<section class="lab-screen language-explore">'+heading('Explore the model’s next word')+'<div class="language-prediction"><span>After “a bird”</span><strong>'+(top?esc(top.word):'No next word found')+'</strong><b>'+(top?top.count+' of '+total+' examples · '+(100*top.probability).toFixed(0)+'%':'')+'</b></div><p class="language-counts">'+state.lmResults.map(x=>esc(x.word)+': '+x.count).join(' · ')+'</p>'+(!state.lmGenerated?'<button class="btn primary" data-action="generate-language">Generate a short text</button>':generated)+'</section>';
}
function screenLanguageEvaluation(){return '<section class="lab-screen language-evaluation">'+heading('Test the model on new sentences')+'<div class="benchmark-intro"><strong>10 fixed next-word cases</strong><span>The benchmark sentences stay separate from the training examples.</span></div><p class="benchmark-explanation">Accuracy counts correct top guesses out of all 10, even unanswered cases. Coverage counts contexts with any prediction.</p><button class="btn primary" data-action="evaluate-language" '+(!state.lmModel?'disabled':'')+'>Evaluate this model</button></section>'}
function languageCase(){const result=state.lmEvaluation?.results[state.lmEvaluationIndex];return result?{result,benchmark:BIGRAM_BENCHMARK[state.lmEvaluationIndex]}:null}
function screenLanguageResult(){
  const evaluation=state.lmEvaluation;if(!evaluation)return '<section class="lab-screen">'+heading('My language model')+'<p class="key-explanation">Train and evaluate the model to create this result card.</p></section>';
  const example=languageCase(),r=example.result,benchmark=example.benchmark;
  const top=r.choices[0],denominator=r.choices.reduce((sum,x)=>sum+x.count,0);
  const detail=top?'<span>'+esc(top.word)+' · '+top.count+'/'+denominator+' examples · '+(100*top.probability).toFixed(0)+'%</span>':'<span>No example followed this context in the training data.</span>';
  const prediction=r.prediction?esc(r.prediction):'No prediction';
  const caseExplanation=r.answered?(r.correct?'Covered: the model predicted the reference word.':'Covered, but the top prediction did not match the reference.'):'Not covered: this context did not appear in the training data.';
  return '<section class="lab-screen language-result-screen"><div class="result-card language-result-card"><header><span>MY LANGUAGE MODEL</span><button type="button" class="text-button" data-action="language-fullscreen">'+(state.lmFullscreen?'Exit presentation':'Show card large')+'</button></header><div class="result-summary"><div><small>Training sentences</small><strong>'+state.lmTrainingCount+'</strong></div></div><div class="result-accuracy"><small>Correct predictions</small><strong>'+evaluation.correct+' / '+evaluation.total+'</strong><span>Next-word accuracy (top guess): '+evaluation.accuracyPercent.toFixed(0)+'%</span></div><div class="language-coverage"><div><b>Coverage</b><span>Contexts with a prediction</span></div><strong>'+evaluation.covered+' / '+evaluation.total+'</strong></div><section class="language-test-example"><header><b>One test case</b><button type="button" class="text-button" data-action="next-language-case">Show another</button></header><p class="test-context">'+esc(benchmark.context)+' → <strong>'+prediction+'</strong></p><p>Reference word: <b>'+esc(benchmark.reference)+'</b> · '+(r.correct?'match':'no match')+'</p><p class="test-status">'+caseExplanation+'</p>'+detail+'</section><p class="accuracy-note">Accuracy is correct top guesses ÷ all ten cases. Exact match on this small test does not measure general language quality; other next words may also make sense.</p></div><div class="language-result-actions"><button class="btn ghost" data-action="change-language-corpus">Change corpus</button><button class="btn primary" data-action="continue-language-summary">Continue</button></div></section>';
}
function searchResults(){const model=state.appModel==='classical'?state.classical:state.neural;if(!model)return '';const found=photos.filter(p=>state.appCategory==='all'||model.predict(p.feature)===state.appCategory);return '<div class="search-results">'+(found.length?found.map(p=>'<figure>'+img(p)+'<figcaption>'+categoryName[model.predict(p.feature)]+'</figcaption></figure>').join(''):'<p class="key-explanation">No photos predicted in this group. Try another group.</p>')+'</div>'}
function screenSearch(){return '<section class="lab-screen search-screen">'+heading('Use predictions in the photo search tool','Filter the local collection by a model’s predicted group.')+'<div class="search-controls"><label>Model<select id="app-model"><option value="classical" '+(state.appModel==='classical'?'selected':'')+'>Nearest neighbor</option><option value="neural" '+(state.appModel==='neural'?'selected':'')+'>Neural network</option></select></label><label>Group<select id="app-category"><option value="all">All groups</option>'+categories.map(c=>'<option value="'+c+'" '+(state.appCategory===c?'selected':'')+'>'+categoryName[c]+'</option>').join('')+'</select></label><button class="btn primary" data-action="run-search">Show photos</button></div>'+(state.appSearched?searchResults():'')+'</section>'}
function screenMatch(){
  const assigned=Object.keys(state.matches).length,items=matchItems.map(item=>'<button type="button" class="match-action '+(state.matches[item.id]?'matched':'')+' '+(state.matchActive===item.id?'active':'')+'" data-match-action="'+item.id+'" aria-pressed="'+(state.matchActive===item.id)+'">'+esc(item.text)+(state.matches[item.id]?'<span>✓ '+esc(matchStages.find(s=>s[0]===state.matches[item.id])[1])+'</span>':'')+'</button>').join('');
  return '<section class="lab-screen match-screen">'+heading('Match each action to its place in the process','Choose an action, then choose its stage. Select a match again to correct it.')+'<div class="match-board"><div class="match-actions"><h2>Actions</h2>'+items+'</div><div class="match-targets"><h2>Process stages</h2>'+matchStages.map(([key,label])=>'<button type="button" class="match-stage" data-match-stage="'+key+'" aria-pressed="false" '+(!state.matchActive?'disabled':'')+'>'+label+'</button>').join('')+'</div></div>'+(state.matchActive?'<p class="match-hint" role="status">Now choose a stage for: '+esc(matchItems.find(x=>x.id===state.matchActive).text)+'</p>':'<p class="match-hint" role="status">'+assigned+' of '+matchItems.length+' actions matched.</p>')+(state.matchFeedback.explanation?'<div class="response-feedback" role="status"><strong>'+state.matchFeedback.title+'</strong><p>'+esc(state.matchFeedback.explanation)+'</p></div>':'')+(assigned===matchItems.length?'<div class="response-feedback"><strong>All actions matched.</strong><p>Inference makes a prediction. Evaluation checks predictions against known labels.</p></div>':'')+'</section>';
}
function screenReflection(){return '<section class="lab-screen reflection-screen">'+heading('How can we build an AI system ourselves?')+'<div class="process-map">'+steps.map(([name,detail],i)=>'<article class="process-step"><b>'+(i+1)+'</b><h2>'+name+'</h2><p>'+detail+'</p></article>').join('')+'</div><p class="key-explanation">Training fits a model. Inference makes predictions. Evaluation checks predictions on unseen, labeled photos. The word experiment used a separate model.</p><label class="reflection-control" for="takeaway">One thing I observed<textarea id="takeaway" rows="2" maxlength="240" placeholder="My models got different results because…">'+esc(state.reflection)+'</textarea></label></section>'}
const screenByName={challenge:screenChallenge,size:screenDataset,labels:screenLabels,measure:screenMeasure,classifier:screenClassifier,network:screenNetwork,evaluation:screenEvaluation,result:screenResult,app:screenSearch,match:screenMatch,languageStart:screenLanguageStart,languageEvidence:screenLanguageEvidence,languageEdit:screenLanguageEdit,languageExplore:screenLanguageExplore,languageEvaluation:screenLanguageEvaluation,languageResult:screenLanguageResult,reflection:screenReflection};
SURVEY_QUESTIONS.forEach((q,i)=>{screenByName['survey-'+q.id]=()=>screenSurvey(q,i)});
const screenFunctions=pageOrder.map(name=>screenByName[name]);
function canTrain(){const chosen=selectedPhotos();return !state.loading&&!state.loadErrors.length&&chosen.length===state.size&&chosen.length>=4&&chosen.every(p=>categories.includes(state.labels[p.id])&&p.feature?.length===128)}
function canContinue(){if(pageOrder[state.page].startsWith('survey-'))return !!state.survey[pageOrder[state.page].slice(7)];if(state.loading||state.loadErrors.length)return false;if(state.page===pages.size)return false;if(state.page===pages.labels)return canTrain();if(state.page===pages.measure)return !!state.classical;if(state.page===pages.classifier)return !!state.classicalResult;if(state.page===pages.network)return !!state.neural;if(state.page===pages.evaluation)return !!state.scores;if(state.page===pages.result)return true;if(state.page===pages.languageEvidence)return state.languageChecked;if(state.page===pages.languageExplore)return !!state.lmGenerated;if(state.page===pages.languageEvaluation)return false;if(state.page===pages.languageResult)return !!state.lmEvaluation;if(state.page===pages.app)return state.appSearched;if(state.page===pages.match)return Object.keys(state.matches).length===matchItems.length;return true}
function render(){
  $('#student-main').innerHTML=screenFunctions[state.page]();
  $('#progress-fill').style.width=(state.page/(pageCount-1)*100)+'%';$('#progress').setAttribute('aria-valuenow',String(state.page+1));
  $('#previous').hidden=state.page===0||state.page===pages.challenge;// Screens with their own primary button hide the shared Continue button.
  const name=pageOrder[state.page],ownButton=['challenge','size','labels','measure','result','languageStart','languageEdit','languageEvaluation','languageResult','reflection'];
  $('#continue').hidden=ownButton.includes(name)||name.startsWith('survey-')&&!state.survey[name.slice(7)]||name==='classifier'&&!state.classicalResult||name==='network'&&!state.neural||name==='evaluation'&&!state.scores||name==='app'&&!state.appSearched||name==='match'&&!canContinue()||name==='languageEvidence'&&!state.languageChecked||name==='languageExplore'&&!state.lmGenerated;
  $('#continue').textContent=state.page===pages.network?'Test both models':state.page===pages.app?'Match the process':state.page===pages.match?'Try a word model':'Continue';$('#continue').disabled=!canContinue();
}
function setPage(page){navigateLesson(state,page,pageCount);render();window.scrollTo({top:0,behavior:'instant'});$('#student-main').focus({preventScroll:true})}
function hogFeatures(image){const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('This browser cannot read local image pixels.');ctx.drawImage(image,0,0,32,32);const pixels=ctx.getImageData(0,0,32,32).data,gray=new Float32Array(1024);for(let p=0;p<1024;p++)gray[p]=(0.299*pixels[p*4]+0.587*pixels[p*4+1]+0.114*pixels[p*4+2])/255;return hogFromGray(gray)}
async function preparePhotos(){const errors=[];await Promise.all(photos.map(photo=>new Promise(resolve=>{const image=new Image();image.onload=()=>{try{photo.feature=hogFeatures(image)}catch(e){errors.push(e.message)}resolve()};image.onerror=()=>{errors.push(photo.name+': image file could not load');resolve()};image.src=photo.src})));state.loadErrors=errors;state.loading=false;render()}
function trainingSamples(){return createTrainingSamples(trainingCandidates,[...state.selected],state.labels)}
function fitClassical(){if(!canTrain())throw new Error('Choose the requested number of labeled training photos.');return trainNearestNeighbor(trainingSamples())}
// Tests both image models on the 12 held-out photos and saves one result per new pair of models.
function testBothModels(){if(!state.scores||state.imageAttempt?.classical!==state.classical||state.imageAttempt?.neural!==state.neural){state.scores={classical:accuracy(state.classical),neural:accuracy(state.neural)};state.reportModel='neural';state.imageAttempt={id:newAttemptId(),classical:state.classical,neural:state.neural};saveResult(state.imageAttempt.id,()=>imageResult({trainingCount:selectedPhotos().length,nearest:state.scores.classical,neural:state.scores.neural}))}}
// After a fix on the labels screen: train both models again and test them in one step.
function retrainAndTest(){state.classical=fitClassical();state.classicalResult=null;state.networkBefore=trainNeuralNetwork(trainingSamples(),{seed:1,epochs:0});state.neural=trainNeuralNetwork(trainingSamples(),{seed:1});testBothModels()}
// Sends the four survey answers once; changing an answer later sends a new set.
function sendSurvey(){const key=JSON.stringify(state.survey);if(state.surveyAttempt?.key===key)return;state.surveyAttempt={id:newAttemptId(),key};const answers={...state.survey};saveResult(state.surveyAttempt.id,()=>surveyResult(answers))}
function clearModels(){if(state.scores)state.previousScores=state.scores;invalidateExperiment(state);state.classicalResult=null;state.neural=null;state.networkBefore=null;state.scores=null;state.appSearched=false;state.inspected.clear()}
function resizeSelection(size){state.size=size;state.selected=new Set(trainingCandidates.filter((_,i)=>i< size).map(p=>p.id));clearModels()}
$('#previous').addEventListener('click',()=>setPage(state.page-1));
$('#continue').addEventListener('click',()=>{if(!canContinue())return;setPage(state.page+1)});
$('#student-main').addEventListener('input',event=>{
  if(event.target.id==='report-note')state.reportNote=event.target.value;
  if(event.target.id==='takeaway')state.reflection=event.target.value;
  if(event.target.id==='lm-examples'){
    state.lmExamples=event.target.value;state.lmCorpusSets[state.lmCorpusSize]=state.lmExamples;state.lmError='';invalidateLanguageExperiment(state);
    const count=state.lmExamples.split(/\n+/).map(x=>x.trim()).filter(Boolean).length,train=$('[data-action="run-language"]');if(train)train.disabled=count!==state.lmCorpusSize;
    const countNode=$('#language-line-count');if(countNode)countNode.textContent=count+' / '+state.lmCorpusSize+' sentences';
    const invalidation=$('#language-invalidation');if(invalidation)invalidation.hidden=false;
  }
});
  $('#student-main').addEventListener('change',event=>{const t=event.target;if(t.dataset.labelFor&&categories.includes(t.value)){state.labels[t.dataset.labelFor]=t.value;clearModels();render();$('select[data-label-for="'+t.dataset.labelFor+'"]')?.focus();return}if(t.id==='classical-photo'){state.classicalPhoto=t.value;state.classicalPeek=false;state.classicalResult=null;render()}if(t.id==='app-model'){state.appModel=t.value;state.appSearched=false;render()}if(t.id==='app-category'){state.appCategory=t.value;state.appSearched=false;render()}});
$('#student-main').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  try{
    if(b.dataset.surveyQuestion){state.survey[b.dataset.surveyQuestion]=b.dataset.surveyAnswer;if(SURVEY_QUESTIONS.every(q=>state.survey[q.id]))sendSurvey();setPage(state.page+1);return}
    if(b.dataset.action==='begin'){setPage(pages.size);return}
    if(b.dataset.size){const size=Number(b.dataset.size);if(size!==state.size)resizeSelection(size);setPage(pages.labels);return}
    if(b.dataset.action==='continue-data'){setPage(pages.measure);return}
    if(b.dataset.action==='retrain-test'){retrainAndTest();setPage(pages.result);return}
    if(b.dataset.action==='train-classical'){state.classical=fitClassical();state.classicalResult=null;setPage(pages.classifier);return}
    if(b.dataset.action==='show-neighbors'){state.classicalPeek=!state.classicalPeek;render();return}
    if(b.dataset.action==='reveal-classifier'){const p=heldOutPhotos.find(x=>x.id===state.classicalPhoto);state.classicalResult={photo:p.id,prediction:state.classical.predict(p.feature)};render();return}
    if(b.dataset.action==='train-neural'){state.networkError='';state.networkBefore=trainNeuralNetwork(trainingSamples(),{seed:1,epochs:0});state.neural=trainNeuralNetwork(trainingSamples(),{seed:1});render();return}
    if(b.dataset.action==='evaluate'){testBothModels();setPage(pages.evaluation);return}
    if(b.dataset.reportModel){state.reportModel=b.dataset.reportModel;render();return}
    if(b.dataset.action==='fullscreen'){state.resultFullscreen=!state.resultFullscreen;document.body.classList.toggle('result-fullscreen',state.resultFullscreen);render();return}
    if(b.dataset.action==='revise'){setPage(pages.labels);return}
    if(b.dataset.action==='continue-to-app'){setPage(pages.app);return}
    if(b.dataset.action==='skip-language'){setPage(pages.reflection);return}
    if(b.dataset.action==='show-language-examples'){setPage(pages.languageEvidence);return}
    if(b.dataset.languageChoice){state.languageChoice=b.dataset.languageChoice;state.lmModel=trainBigramLanguageModel(['a bird flies','a bird swims','a bird sings','a bird swims']);state.languageChecked=true;state.lmResults=state.lmModel.predictNext('a bird');const best=state.lmResults[0]?.word;state.languageFeedback=state.languageChoice===best?'The counts support “'+best+'”.':'The most common example is “'+best+'”.';render();return}
    if(b.dataset.languageSize){state.lmCorpusSets[state.lmCorpusSize]=state.lmExamples;state.lmCorpusSize=Number(b.dataset.languageSize);state.lmExamples=state.lmCorpusSets[state.lmCorpusSize];state.lmError='';invalidateLanguageExperiment(state);render();$('button[data-language-size="'+state.lmCorpusSize+'"]')?.focus();return}
    if(b.dataset.action==='run-language'){
      state.lmExamples=$('#lm-examples').value;const sentences=state.lmExamples.split(/\n+/).map(x=>x.trim()).filter(Boolean);state.lmError='';invalidateLanguageExperiment(state);
      if(sentences.length!==state.lmCorpusSize){state.lmError='Use exactly '+state.lmCorpusSize+' sentences.';render();return}
      try{state.lmModel=trainBigramLanguageModel(sentences);state.lmResults=state.lmModel.predictNext('a bird');if(!state.lmResults.length)throw new Error('Keep at least one example with a word after “bird”.');state.lmTrainingCount=sentences.length;state.lmRan=true;state.lmInvalidated=false;state.lmCorpusSets[state.lmCorpusSize]=state.lmExamples;setPage(pages.languageExplore)}
      catch(e){state.lmError=e.message;state.lmRan=false;state.lmModel=null;state.lmResults=[];render()}return
    }
    if(b.dataset.action==='generate-language'){if(!state.lmModel||!state.lmRan)throw new Error('Train the text model first.');state.lmGenerated=state.lmModel.generate('a bird',5).join(' ');render();return}
    if(b.dataset.action==='evaluate-language'){if(!state.lmModel||!state.lmRan)throw new Error('Train the bigram model first.');if(!state.lmEvaluation||state.languageAttempt?.model!==state.lmModel){state.lmEvaluation=evaluateBigramBenchmark(state.lmModel,BIGRAM_BENCHMARK);state.languageAttempt={id:newAttemptId(),model:state.lmModel};saveResult(state.languageAttempt.id,()=>languageResult({trainingSentences:state.lmTrainingCount,evaluation:state.lmEvaluation}))}state.lmEvaluationIndex=0;setPage(pages.languageResult);return}
    if(b.dataset.action==='next-language-case'){state.lmEvaluationIndex=(state.lmEvaluationIndex+1)%BIGRAM_BENCHMARK.length;render();$('[data-action="next-language-case"]')?.focus();return}
    if(b.dataset.action==='language-fullscreen'){state.lmFullscreen=!state.lmFullscreen;document.body.classList.toggle('language-fullscreen',state.lmFullscreen);render();$('[data-action="language-fullscreen"]')?.focus();return}
    if(b.dataset.action==='change-language-corpus'){if(state.lmFullscreen){state.lmFullscreen=false;document.body.classList.remove('language-fullscreen')}setPage(pages.languageEdit);return}
    if(b.dataset.action==='continue-language-summary'){if(state.lmFullscreen){state.lmFullscreen=false;document.body.classList.remove('language-fullscreen')}setPage(pages.reflection);return}
    if(b.dataset.action==='run-search'){state.appSearched=true;render();return}
    if(b.dataset.matchAction){state.matchActive=b.dataset.matchAction;if(state.matches[state.matchActive])delete state.matches[state.matchActive];state.matchFeedback={};render();$('.match-stage:not(:disabled)')?.focus();return}
    if(b.dataset.matchStage){if(!state.matchActive)return;const item=matchItems.find(x=>x.id===state.matchActive),correct=item.answer===b.dataset.matchStage;if(correct){state.matches[item.id]=item.answer;state.matchFeedback={title:'Matched',explanation:item.why};state.matchActive=''}else state.matchFeedback={title:'That stage does not fit yet. Try another.',explanation:'Think about whether this action prepares examples, fits a model, makes a prediction, or checks known answers.'};render();if(correct)$('.match-action:not(.matched)')?.focus();else $('.match-stage:not(:disabled)')?.focus();return}
  }catch(e){state.modelError=e.message;render()}
});
document.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select,button'))return;if(event.key==='ArrowRight'&&canContinue()&&!$('#continue').hidden){event.preventDefault();$('#continue').click()}if(event.key==='ArrowLeft'&&state.page>0){event.preventDefault();$('#previous').click()}});
preparePhotos();render();
