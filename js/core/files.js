// file: js/core/files.js
export function download(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
export function fileName(state, ext){
  const n = (state.name || 'форма').trim().replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,'_');
  return (n || 'форма') + '.' + ext;
}
