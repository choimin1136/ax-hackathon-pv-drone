// Code-generated fixtures, never actual photos, model predictions or ground truth.
export function syntheticAssets(candidates) {
  const wrap = content => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="512" viewBox="0 0 640 512">${content}</svg>`;
  const uri = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const panels = Array.from({length:12},(_,i)=>`<rect x="${25+i%4*150}" y="${35+Math.floor(i/4)*150}" width="135" height="130" rx="4" fill="${i%3?'#a66052':'#cd9560'}" stroke="#eecca3" stroke-width="2"/>`).join('');
  const heat = candidates.map(c=>`<ellipse cx="${c.bbox[0]+c.bbox[2]/2}" cy="${c.bbox[1]+c.bbox[3]/2}" rx="23" ry="28" fill="#ffe9a1"/>`).join('');
  const mask = candidates.map(c=>`<ellipse cx="${c.bbox[0]+c.bbox[2]/2}" cy="${c.bbox[1]+c.bbox[3]/2}" rx="23" ry="28" fill="#36e9d8" fill-opacity="0.65"/>`).join('');
  return {width:640,height:512,source:'synthetic',photo:uri(wrap(`<rect width="640" height="512" fill="#382f50"/>${panels}${heat}<text x="25" y="500" fill="white" font-size="15">SYNTHETIC DEMO - NOT A REAL PHOTO</text>`)),mask:uri(wrap(mask))};
}

// Invalidate late loads when changing cells, retrying or closing the dialog.
export function loadGeneration() {
  let generation = 0;
  return {next:()=>++generation,current:id=>id===generation};
}
