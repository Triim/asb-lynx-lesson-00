// Pure, offline model code shared by the student lab (student.js) and verify.mjs.
// No DOM, no network: everything here runs the same in the browser and in Node.
//
// What lives in this file, in lesson order:
//   1. hogFromGray          — turns one photo into 128 numbers ("measurements", HOG features).
//   2. trainNearestNeighbor — image MODEL A: keeps the labeled examples, 3 nearest ones vote.
//   3. trainNeuralNetwork   — image MODEL B: a tiny neural network that learns weights.
//   4. evaluateHeldOut*     — tests a trained image model on the 12 held-out photos.
//   5. trainBigramLanguageModel + evaluateBigramBenchmark — the separate text experiment.
// Both image models get exactly the same input: the same 128 measurements per photo and the
// labels the student chose. They differ only in HOW they learn from those examples.
//
// The photo list itself (which photos exist, which are for training or testing) is in dataset.js.
export const CATEGORY_IDS = ['dog', 'cat', 'bird', 'vehicle'];

export const BIGRAM_CORPUS_OPTIONS = [8, 12, 16];
export const BIGRAM_CORPUS_CANDIDATES = [
  'a bird flies','a bird swims','a bird sings','a bird swims',
  'a cat sleeps','a cat purrs','a dog runs','a dog plays',
  'a fox sleeps','a fox hunts','a robot helps','a robot learns',
  'a child reads','a child plays','the sun shines','the sun warms',
];
export const BIGRAM_BENCHMARK = [
  // Held-out references deliberately include plausible alternatives to the modal
  // training continuation, so the benchmark tests prediction choices as well as coverage.
  {context:'a bird',reference:'flies',sentence:'Over the garden, a bird flies.'},
  {context:'a cat',reference:'purrs',sentence:'On the rug, a cat purrs.'},
  {context:'a dog',reference:'runs',sentence:'Across the field, a dog runs.'},
  {context:'a fox',reference:'hunts',sentence:'At dusk, a fox hunts alone.'},
  {context:'a robot',reference:'learns',sentence:'In class, a robot learns quickly.'},
  {context:'a child',reference:'reads',sentence:'During free time, a child reads.'},
  {context:'the wind',reference:'blows',sentence:'Across the plain, the wind blows.'},
  {context:'the sun',reference:'warms',sentence:'In the morning, the sun warms the ground.'},
  {context:'a plane',reference:'lands',sentence:'At sunset, a plane lands safely.'},
  {context:'a river',reference:'flows',sentence:'Through the valley, a river flows.'},
];

// ---------------------------------------------------------------------------------------------
// 1. MEASUREMENTS (HOG features)
// The browser shrinks every photo to 32×32 grey pixels (see hogFeatures in student.js) and
// calls this function. The image is cut into a 4×4 grid of cells. In each cell we measure
// edges: how strongly brightness changes and in which of 8 directions. 16 cells × 8
// directions = 128 numbers. This recipe is fixed: it is not learned and does not "know" dogs.
// ---------------------------------------------------------------------------------------------
export function hogFromGray(gray) {
  if (!gray || gray.length !== 32 * 32 || !Array.from(gray).every(Number.isFinite)) throw new Error('A 32 by 32 grayscale image is required.');
  const descriptor = [];
  for (let cellY = 0; cellY < 4; cellY++) for (let cellX = 0; cellX < 4; cellX++) {
    const bins = Array(8).fill(0);
    for (let y = cellY * 8 + 1; y < cellY * 8 + 7; y++) for (let x = cellX * 8 + 1; x < cellX * 8 + 7; x++) {
      const dx = gray[y * 32 + x + 1] - gray[y * 32 + x - 1];
      const dy = gray[(y + 1) * 32 + x] - gray[(y - 1) * 32 + x];
      const magnitude = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) + Math.PI) % Math.PI;
      bins[Math.min(7, Math.floor(angle / Math.PI * 8))] += magnitude;
    }
    // Normalise each cell so a bright and a dark photo of the same shape give similar numbers.
    const norm = Math.sqrt(bins.reduce((sum, value) => sum + value * value, 1e-8));
    descriptor.push(...bins.map((value) => value / norm));
  }
  return descriptor;
}

function validateSamples(samples, featureLength = 128) {
  if (!Array.isArray(samples) || samples.length < 4) throw new Error('At least four labeled training photos are needed.');
  if (samples.some(({ x, y }) => !Array.isArray(x) || x.length !== featureLength || !x.every(Number.isFinite) || !CATEGORY_IDS.includes(y))) {
    throw new Error('Training examples must have complete image features and one of the four supported labels.');
  }
}

// ---------------------------------------------------------------------------------------------
// 2. MODEL A — NEAREST NEIGHBOR (k = 3)
// "Training" is just remembering: the model stores every labeled example as it is.
// To predict a new photo it measures the distance between the photo's 128 numbers and each
// stored example, takes the 3 closest examples and lets their labels vote.
// Easy to explain: a prediction can always be traced back to three concrete training photos.
// A wrong label in the training set directly becomes a wrong vote.
// ---------------------------------------------------------------------------------------------
export function trainNearestNeighbor(samples) {
  validateSamples(samples);
  const saved = samples.map(({ id, x, y }) => ({ ...(id === undefined ? {} : { id }), x: [...x], y }));
  return {
    samples: saved,
    predict(vector) {
      if (!Array.isArray(vector) || vector.length !== 128 || !vector.every(Number.isFinite)) throw new Error('This photo has no usable image features.');
      // Squared Euclidean distance to every stored example, closest three first.
      const nearest = saved.map((sample) => ({ label: sample.y, distance: sample.x.reduce((sum, value, index) => sum + (value - vector[index]) ** 2, 0) })).sort((a, b) => a.distance - b.distance).slice(0, 3);
      // Each of the three neighbors votes for its label; ties go to the first group in CATEGORY_IDS.
      const votes = Object.fromEntries(CATEGORY_IDS.map((category) => [category, 0]));
      nearest.forEach(({ label }) => { votes[label] += 1; });
      return CATEGORY_IDS.reduce((best, category) => votes[category] > votes[best] ? category : best, CATEGORY_IDS[0]);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 3. MODEL B — A SMALL NEURAL NETWORK
// Same input as model A, different idea. The network does NOT keep the examples. It has
// weights (numbers) that turn 128 measurements into 4 group scores:
//   128 measurements → 24 hidden units (ReLU) → 4 scores → softmax → probabilities.
// Training starts from small random weights and repeats 180 passes over the chosen examples.
// After each example it nudges every weight a little so the correct label gets a higher
// probability (gradient descent on cross-entropy loss). After training, only the weights
// are needed to predict.
// The fixed seed makes every run with the same photos and labels give the same result,
// so students can compare their numbers fairly.
// ---------------------------------------------------------------------------------------------
export function trainNeuralNetwork(samples, { seed = 1, epochs = 180, learningRate = 0.025 } = {}) {
  validateSamples(samples);
  const examples = samples.map(({ id, x, y }) => ({ ...(id === undefined ? {} : { id }), x: [...x], y: CATEGORY_IDS.indexOf(y) }));
  // Small deterministic random generator (LCG) for the starting weights.
  let randomState = seed >>> 0;
  const random = () => { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 4294967296 - 0.5; };
  const matrix = (rows, columns) => Array.from({ length: rows }, () => Array.from({ length: columns }, () => random() * 0.08));
  // w1/b1: measurements → hidden units. w2/b2: hidden units → one score per group.
  const w1 = matrix(24, 128), b1 = Array(24).fill(0), w2 = matrix(4, 24), b2 = Array(4).fill(0);
  // Forward pass: compute the hidden units, the 4 scores, then turn scores into probabilities.
  const forward = (x) => {
    const hidden = w1.map((row, index) => Math.max(0, row.reduce((sum, value, feature) => sum + value * x[feature], b1[index])));
    const logits = w2.map((row, index) => row.reduce((sum, value, unit) => sum + value * hidden[unit], b2[index]));
    const maximum = Math.max(...logits), exponential = logits.map((value) => Math.exp(value - maximum)), total = exponential.reduce((sum, value) => sum + value, 0);
    return { hidden, probabilities: exponential.map((value) => value / total) };
  };
  // Loss = how surprised the network is by the correct labels, averaged over training examples.
  // It describes the training photos only; it is NOT accuracy on new photos.
  const loss = () => examples.reduce((sum, example) => sum - Math.log(Math.max(1e-8, forward(example.x).probabilities[example.y])), 0) / examples.length;
  const lossBefore = loss();
  // Training loop (backpropagation): for each example, find how each weight affected the error
  // and move it a small step (learningRate) in the direction that reduces the error.
  for (let epoch = 0; epoch < epochs; epoch++) for (const example of examples) {
    const { hidden, probabilities } = forward(example.x);
    const outputGradient = probabilities.map((probability, index) => probability - (index === example.y ? 1 : 0));
    const hiddenGradient = w2[0].map((_, unit) => w2.reduce((sum, row, output) => sum + row[unit] * outputGradient[output], 0));
    for (let output = 0; output < 4; output++) {
      for (let unit = 0; unit < 24; unit++) w2[output][unit] -= learningRate * outputGradient[output] * hidden[unit];
      b2[output] -= learningRate * outputGradient[output];
    }
    for (let unit = 0; unit < 24; unit++) {
      const gradient = hidden[unit] > 0 ? hiddenGradient[unit] : 0;
      for (let feature = 0; feature < 128; feature++) w1[unit][feature] -= learningRate * gradient * example.x[feature];
      b1[unit] -= learningRate * gradient;
    }
  }
  return {
    samples: examples,
    lossBefore,
    lossAfter: loss(),
    predict(vector) {
      if (!Array.isArray(vector) || vector.length !== 128 || !vector.every(Number.isFinite)) throw new Error('This photo has no usable image features.');
      const probabilities = forward(vector).probabilities;
      return CATEGORY_IDS[probabilities.indexOf(Math.max(...probabilities))];
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 4. EVALUATION ON HELD-OUT PHOTOS
// Both image models are tested on the same 12 photos that are never offered for training.
// Accuracy = correctly classified ÷ 12. A photo used for training can never be used here.
// ---------------------------------------------------------------------------------------------
export function evaluateHeldOut(model, photos) {
  if (!model || !Array.isArray(photos) || photos.length === 0) throw new Error('A trained model and held-out photos are required.');
  const trainingIds = new Set((model.samples || []).map((sample) => sample.id).filter(Boolean));
  if (photos.some((photo) => trainingIds.has(photo.id))) throw new Error('A training photo cannot also be used for evaluation.');
  return photos.map((photo) => {
    const prediction = model.predict(photo.feature);
    return { id: photo.id, prediction, truth: photo.truth, correct: prediction === photo.truth };
  });
}

// Builds the training set from the student's chosen photo IDs and the labels they kept or changed.
export function createTrainingSamples(candidates, selectedIds, labels) {
  if (!Array.isArray(candidates) || !Array.isArray(selectedIds) || selectedIds.length < 4 || new Set(selectedIds).size !== selectedIds.length) {
    throw new Error('Choose at least four different training photos.');
  }
  const byId = new Map(candidates.filter((photo) => photo.split === 'train').map((photo) => [photo.id, photo]));
  return selectedIds.map((id) => {
    const photo = byId.get(id), y = labels[id];
    if (!photo || !Array.isArray(photo.feature) || photo.feature.length !== 128 || !CATEGORY_IDS.includes(y)) {
      throw new Error('Every selected photo needs complete measurements and one category label.');
    }
    return { id, x: photo.feature, y };
  });
}

export function evaluateHeldOutAccuracy(model, photos) {
  const results = evaluateHeldOut(model, photos);
  const correct = results.filter((item) => item.correct).length;
  return { results, correct, total: results.length, percent: 100 * correct / results.length };
}

// Any change to photos or labels throws the old models away: they no longer match the data.
export function invalidateExperiment(experiment) {
  const hadFittedResults = Boolean(experiment.classical || experiment.neural || experiment.inspected.size);
  experiment.classical = null;
  experiment.neural = null;
  experiment.inspected.clear();
  experiment.modelError = '';
  experiment.appSearched = false;
  experiment.invalidated = experiment.invalidated || hadFittedResults;
  experiment.labelRevision += 1;
}

export function classifyActions(items, selections) {
  let correct = 0;
  const results = items.map((item) => {
    const answer = selections[item.id] || '';
    const isCorrect = answer === item.answer;
    if (isCorrect) correct += 1;
    return { id: item.id, answer, expected: item.answer, correct: isCorrect, explanation: item.why };
  });
  return { correct, total: items.length, results };
}

// ---------------------------------------------------------------------------------------------
// 5. THE SEPARATE TEXT EXPERIMENT (bigram model, trained further below)
// Scores a bigram model on 10 fixed next-word cases. Accuracy counts exact top guesses out of
// all 10; coverage counts the cases where the model had any guess at all.
// ---------------------------------------------------------------------------------------------
export function evaluateBigramBenchmark(model, benchmark = BIGRAM_BENCHMARK) {
  if (!model || typeof model.predictNext !== 'function' || !Array.isArray(benchmark) || benchmark.length === 0) {
    throw new Error('A trained bigram model and fixed benchmark are required.');
  }
  const results = benchmark.map((test) => {
    const choices = model.predictNext(test.context);
    const prediction = choices[0]?.word || null;
    return {
      context: test.context,
      reference: test.reference,
      prediction,
      choices,
      answered: Boolean(prediction),
      correct: Boolean(prediction) && prediction === test.reference,
    };
  });
  const correct = results.filter((item) => item.correct).length;
  const covered = results.filter((item) => item.answered).length;
  return {
    results,
    correct,
    total: results.length,
    accuracy: correct / results.length,
    accuracyPercent: 100 * correct / results.length,
    covered,
    coverage: covered / results.length,
    coveragePercent: 100 * covered / results.length,
  };
}

export function invalidateLanguageExperiment(experiment) {
  experiment.lmModel = null;
  experiment.lmEvaluation = null;
  experiment.lmGenerated = '';
  experiment.lmResults = [];
  experiment.lmRan = false;
  experiment.lmInvalidated = true;
}

export function navigateLesson(lessonState, requestedPage, pageCount) {
  lessonState.page = Math.max(0, Math.min(pageCount - 1, requestedPage));
  return lessonState.page;
}

// A transparent bigram language model: count which word followed each word.
// "Training" = counting word pairs in the student's sentences. Prediction = the word that most
// often followed the last word of the context. It is not a neural network and is unrelated
// to the image models above.
export function trainBigramLanguageModel(sentences) {
  if (!Array.isArray(sentences) || sentences.length < 2) throw new Error('Add at least two training sentences.');
  const counts = new Map(), totals = new Map(), vocabulary = new Set();
  for (const sentence of sentences) {
    const words = String(sentence).toLowerCase().match(/[a-z]+|[.!?]/g) || [];
    if (words.length < 2) continue;
    words.forEach((word) => vocabulary.add(word));
    const sequence = ['<start>', ...words];
    for (let i = 0; i < sequence.length - 1; i++) {
      const previous = sequence[i], next = sequence[i + 1];
      if (!counts.has(previous)) counts.set(previous, new Map());
      const row = counts.get(previous);
      row.set(next, (row.get(next) || 0) + 1);
      totals.set(previous, (totals.get(previous) || 0) + 1);
    }
  }
  if (totals.size < 2) throw new Error('Add at least two useful training sentences.');
  const predictNext = (context) => {
    const words = String(context).toLowerCase().match(/[a-z]+|[.!?]/g) || [];
    const row = counts.get(words.at(-1) || '<start>');
    return row ? [...row].map(([word, count]) => ({word, count, probability: count / totals.get(words.at(-1) || '<start>')})).sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)) : [];
  };
  const generate = (prompt, steps = 5) => {
    const output = [];
    let context = prompt;
    for (let i = 0; i < steps; i++) {
      const next = predictNext(context)[0];
      if (!next || /^[.!?]$/.test(next.word)) break;
      output.push(next.word);
      context = `${context} ${next.word}`;
    }
    return output;
  };
  return {predictNext, generate, vocabularySize: vocabulary.size, sentenceCount: sentences.length};
}
