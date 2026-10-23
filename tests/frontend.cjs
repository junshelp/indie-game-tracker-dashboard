const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const callbacks = {};
const dom = {};
const document = {
  querySelector(selector) { return dom[selector] ||= { innerHTML: '', style: {}, setAttribute() {} }; },
  querySelectorAll() { return []; },
  addEventListener(type, handler) { (callbacks[type] ||= []).push(handler); },
};
const context = vm.createContext({document, console, URL, Intl, Date, setTimeout,
  fetch: async () => ({ok: true, json: async () => ({games: [{appid: 1, name: 'Game', status: 'upcoming', genres: ['Indie']}], summary: {total:1,top_genres:[]}, changes: []})})});
vm.runInContext(fs.readFileSync('app.js', 'utf8').replace(/\ninit\(\);\s*$/, '\n'), context);
const run = code => vm.runInContext(code, context);
assert.equal(run("formatDateShort('2026-10-24')"), '10/24');
assert.equal(run("formatDateRange('2026-10-29','2026-11-01')"), '10/29–11/1');
assert.equal(run("cleanURL('-')"), null);
assert.equal(run("cleanURL('javascript:alert(1)')"), null);
assert.equal(run("releaseSortTime('To be announced')"), Infinity);
assert.ok(run("releaseSortTime('Q1 2027') > releaseSortTime('24 Oct, 2026')"));
run("state.data={events:[{id:'a',name:'Korea',countryCode:'KR',typeLabel:'전시회',startDate:'2099-10-24',endDate:'2099-10-24',status:'past'},{id:'b',name:'Japan',countryCode:'JP',typeLabel:'전시회',startDate:'2099-10-25',endDate:'2099-10-25',status:'past'}]}; state.view='timeline'; refreshEventStats();");
assert.equal(run('state.data.summary.upcomingEvents'), 2);
const button = {dataset:{country:'KR'},classList:{add(){},remove(){}},hasAttribute(){return false;},matches(selector){return selector==='.filter-btn[data-country]';}};
for (const cb of callbacks.click) cb({target:{closest(){return button;}}});
assert.equal(run('state.country'), 'KR', 'clicks on child spans activate their country button');
assert.equal(run('filteredEvents().length'), 1);
(async () => {
  run("state.view='steam'; steamState.loading=true;");
  await run('loadSteamData()');
  assert.equal(run('steamState.loading'), false);
  assert.ok(dom['#viewSteam'].innerHTML.includes('Game'), 'active Steam view re-renders after async data arrives');
  context.fetch = async url => ({ok: !url.includes('history.json'), status: 503,
    json: async () => url.includes('/steam/') ? ({games:[{appid:1,name:'Game',status:'upcoming',genres:['Indie']}],summary:{total:1,top_genres:[]}}) : ({generatedAt:'2026-10-23T01:00:00Z', events:[{id:'a',name:'Sample',countryCode:'KR',typeLabel:'전시회',startDate:'2099-10-24',endDate:'2099-10-24'}]})});
  run("state.view='timeline';");
  await run('init()');
  assert.equal(run('state.history.unavailable'), true);
  assert.ok(dom['#viewTimeline'].innerHTML.includes('Sample'), 'optional history failure leaves events usable');
  await new Promise(resolve => setImmediate(resolve));
  context.fetch = async () => ({ok:false,status:503});
  run("state.view='steam';");
  await run('loadSteamData()');
  assert.ok(dom['#viewSteam'].innerHTML.includes('data-retry="steam"'), 'Steam failure offers retry instead of empty results');
  console.log('Frontend behavior checks passed');
})().catch(error => {console.error(error);process.exitCode=1;});
