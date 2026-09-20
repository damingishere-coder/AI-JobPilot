const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'boss-content.js'), 'utf8');
const clickSource = source.slice(source.indexOf('  function clickElement(el) {'), source.indexOf('  function extractBossId(url) {'));

function harness() {
  let active = true, activations = 0;
  const events = [];
  class Event { constructor(type) { this.type = type; } }
  const context = vm.createContext({ PointerEvent: Event, MouseEvent: Event, isCurrentContentInstance: () => active });
  vm.runInContext(clickSource, context);
  const element = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }),
    dispatchEvent(event) { events.push(event.type); if (event.type === 'click') activations++; },
    click() { events.push('click'); activations++; }
  };
  return { context, element, events, count: () => activations, leave: () => { active = false; } };
}

test('BOSS communication, favourite and send controls activate exactly once', () => {
  const h = harness();
  h.context.clickElement(h.element);
  assert.equal(h.count(), 1, 'a synthetic click followed by element.click invokes the site twice');
  assert.deepEqual(h.events, ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']);
});

test('a page restored from BFCache cannot resume an old delivery click', () => {
  const h = harness();
  h.leave();
  assert.throws(() => h.context.clickElement(h.element), /页面已离开/);
  assert.equal(h.count(), 0);
});

test('navigation during pointer events cancels the final click', () => {
  const h = harness();
  const dispatch = h.element.dispatchEvent;
  h.element.dispatchEvent = event => { dispatch(event); if (event.type === 'mouseup') h.leave(); };
  assert.throws(() => h.context.clickElement(h.element), /页面已离开/);
  assert.equal(h.count(), 0);
});
