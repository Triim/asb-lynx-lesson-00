// Metadata for the locally bundled Lesson 0 photos. Features are computed in the browser.
const rows = [
  ['dog-golden','Golden dog','dog','train'],['dog-black','Black dog','dog','train'],['dog-terrier','Terrier in grass','dog','train'],['gen-dog-white','Dog by a window','dog','train'],
  ['cat-orange','Orange cat','cat','train'],['cat-tabby','Tabby cat','cat','train'],['cat-black','Black cat','cat','train'],['gen-cat-orange-window','Orange cat by a window','cat','train'],
  ['bird-cardinal','Cardinal','bird','train'],['bird-duck','Duck on water','bird','train'],['bird-blue','Blue bird','bird','train'],['gen-bird-bluejay-training','Blue jay on a fence','bird','train'],
  ['vehicle-bicycle','Bicycle','vehicle','train'],['vehicle-bus','Bus','vehicle','train'],['vehicle-car','Car','vehicle','train'],['gen-vehicle-van-tree','Van behind a tree','vehicle','train'],
  ['gen-dog-golden-field','Golden dog in a field','dog','test'],['gen-dog-black','Black dog in shade','dog','test'],['gen-dog-terracotta','Dog among plants','dog','test'],
  ['gen-cat-grey-garden','Grey cat in a garden','cat','test'],['gen-cat-black-room','Cat in a dim room','cat','test'],['gen-cat-tabby-window','Cat at a window','cat','test'],
  ['gen-bird-cardinal-branch','Cardinal in branches','bird','test'],['gen-bird-duck-pond','Duck on a pond','bird','test'],['gen-bird-bluejay','Blue jay on a fence','bird','test'],
  ['gen-vehicle-bus-rain','Bus in rain','vehicle','test'],['gen-vehicle-bicycle-brick','Bicycle by a wall','vehicle','test'],['gen-vehicle-car-shade','Car in tree shade','vehicle','test'],
];
export const photos = rows.map(([id,name,truth,split],index)=>({id,name,truth,split,src:'photos/'+id+'.jpg',feature:null,index}));
export const categories = ['dog','cat','bird','vehicle'];
const candidatesByCategory = Object.fromEntries(categories.map(category=>[category,photos.filter(p=>p.split==='train'&&p.truth===category)]));
export const trainingCandidates = Array.from({length:4},(_,index)=>categories.map(category=>candidatesByCategory[category][index])).flat();
export const heldOutPhotos = photos.filter(p=>p.split==='test');
export const categoryName = {dog:'Dogs',cat:'Cats',bird:'Birds',vehicle:'Vehicles'};
