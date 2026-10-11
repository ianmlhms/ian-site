/* All economy, job and world balance lives here. Values are euros, metres, seconds. */
(function(P){
  'use strict';
  P.config = Object.freeze({
    shiftSeconds:300,stopRadius:6,stopSpeed:2.7,stopDwell:.65,crashCooldown:1.2,freeRate:.5, comboSeconds:20, combo:[1,1.2,1.5,2,2.5,3], crashCost:12,
    traffic:{off:{count:0,multiplier:.6,icon:'🌿'},low:{count:22,multiplier:.85,icon:'🚙'},normal:{count:46,multiplier:1,icon:'🚗'},rush:{count:76,multiplier:1.3,icon:'🚦'}},
    qualityCaps:{high:76,medium:46,low:22}, stuckSeconds:6,
    vehicles:[
      {id:'auto',name:'autoName',icon:'🚗',price:0,legacy:0,speed:24,accel:9,turn:2.2,length:4.1,stops:1,base:120},
      {id:'van',name:'vanName',icon:'🚐',price:4000,legacy:1500,speed:20,accel:6,turn:1.8,length:5.3,stops:2,base:135},
      {id:'bus',name:'busName',icon:'🚌',price:7000,legacy:5000,speed:16,accel:4,turn:1.5,length:8,stops:3,base:190},
      {id:'sport',name:'sportName',icon:'⚡',price:12000,speed:34,accel:13,turn:2.4,length:4.4,stops:1,base:145},
      {id:'truck',name:'truckName',icon:'🚛',price:10000,speed:18,accel:5,turn:1.6,length:7,stops:3,base:170}
    ],
    upgrades:{motor:[900,1300,1900],tyres:[500,800,1200],storage:[500,800,1200],battery:[250,450,700],paint:[100,150,250]},
    motorSpeed:.07,motorAccel:.1,tyreGrip:.09,batteryBonus:.04,
    colors:['#edb44e','#48b9b0','#c65c80','#516bd2'],
    districts:{'Alstad':0,'Garer Quartier':0,'Kirchberg':2500,'Belair':4000,'Ateliers':6000,'Parc de la Pétrusse':8000},
    ranks:[0,3000,12000,35000,75000],
    job:{standard:1,fragile:1.5,express:2,pizza:1.4,multi:1,heavy:2.1,bus:1.1},
    fragileLoss:.25,pizzaSeconds:90,pizzaFloor:0,expressTime:.6,bonusPerSecond:.65,
    jobTiming:{base:35,speedRate:.48,stop:8,minDistance:50,maxDistance:260},
    jobWeights:{standard:6,fragile:2,express:2,pizza:2,multi:4,heavy:3},
    busMaxStops:5,multiMinStops:2,multiMaxStops:3,parcelBonus:.12,
    dailyReward:250,starReward:150,radarFine:35,radarGrace:3,weatherBonus:1.2,rainGrip:.76,
    limits:{town:50,oldTown:30,outer:70},
    missionTargets:{delivery:5,drift:300,clean:1,express:3,combo:2},
    dailyJobs:8,dailyTraffic:'normal',dailyVehicle:'auto',dailySlots:2
  });
})(window.PX);
