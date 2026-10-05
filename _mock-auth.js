// screenshot-only mock of auth.js (never deployed)
const m=new URLSearchParams(location.search).get("mock")||"in";
const mk=()=>{const o={};for(const k of ["select","eq","upsert"])o[k]=()=>o;o.maybeSingle=async()=>({data:null,error:null});o.then=(r)=>r({data:null,error:null});return o;};
const sb={from:()=>mk()};
export const authConfigured=true;
export const client=async()=>sb;
export const session=()=>m==="out"?null:{user:{id:"u1"}};
export const onAuth=()=>{};
export const mountAccountButton=(el)=>{if(el)el.innerHTML='<button type="button" style="min-height:44px;padding:8px 14px;border-radius:14px;border:1px solid var(--border);background:transparent;color:var(--text);font:700 14px system-ui">ian</button>';};
export const openAuthModal=()=>{};
