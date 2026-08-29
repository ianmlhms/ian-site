'use strict';
const assert=require('node:assert/strict');
const core=require('./core.js');

const MAX_STEPS=6000;
const START_Y_OFFSET=43;
const delaySets=[
  {name:'obstacle-aware',values:Array.from({length:33},(_,i)=>i*15),input:(terrain,car,level)=>core.botInput(terrain,car,level)},
  {name:'timed-throttle',values:Array.from({length:361},(_,i)=>i*2),input:(terrain,car)=>{
    if(car.grounded)return{up:true};
    if(car.angle<-.1)return{down:true};
    if(car.angle>.12)return{up:true};
    return{};
  }}
];

function attempt(levelIndex,delay,policy){
  const terrain=core.buildLevel(core.LEVELS[levelIndex]);
  const startY=core.groundY(terrain,core.CAR_START_X)-START_Y_OFFSET;
  const car=core.newCar(core.CAR_START_X,startY);
  let furthest=car.x,lastProgressStep=0;
  for(let step=0;step<MAX_STEPS;step++){
    const input=step<delay?{}:policy.input(terrain,car,levelIndex);
    core.stepCar(terrain,car,input);
    if(car.x>furthest+1){furthest=car.x;lastProgressStep=step;}
    if(car.won)return{passed:true,steps:step+1,policy:policy.name,delay};
    if(car.crashed)return{passed:false,reason:'crash'};
    if(step-lastProgressStep>1800)return{passed:false,reason:'stuck'};
  }
  return{passed:false,reason:'timeout'};
}

function solve(levelIndex){
  for(const policy of delaySets){
    for(const delay of policy.values){const result=attempt(levelIndex,delay,policy);if(result.passed)return result;}
  }
  return{passed:false,reason:'no bot route completed'};
}

const results=core.LEVELS.map((level,index)=>({level:index+1,name:level.name,...solve(index)}));
console.log('| Level | Name | Completable | Time |');
console.log('|---:|---|:---:|---:|');
for(const result of results)console.log(`| ${result.level} | ${result.name} | ${result.passed?'yes':'NO'} | ${result.passed?(result.steps/60).toFixed(2)+'s':'—'} |`);
assert.equal(core.LEVELS.length,16,'expected exactly 16 levels');
assert.ok(results.every(result=>result.passed),'every level must be completable without throwing or getting stuck');
