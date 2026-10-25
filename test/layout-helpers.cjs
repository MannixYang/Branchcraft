const assert = require('node:assert/strict');

// Wait for observable geometry AND control metadata to stop changing. No sleeps,
// retries of failed actions, or swallowed assertions. Hidden controls are excluded.
async function settleLayout(page) {
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll('.panel-splitter,[data-height]')]
      .filter(n => n.getClientRects().length && getComputedStyle(n).display !== 'none');
    const snapshot = JSON.stringify([innerWidth, innerHeight, ...nodes.map(n => {
      const b = n.getBoundingClientRect();
      return [n.className, n.dataset.height, b.x, b.y, b.width, b.height,
        n.getAttribute('aria-valuenow'), n.getAttribute('aria-valuemin'), n.getAttribute('aria-valuemax')];
    })]);
    const state = window.__layoutTestState ||= {};
    state.frames = state.snapshot === snapshot ? state.frames + 1 : 0;
    state.snapshot = snapshot;
    return nodes.length > 0 && state.frames >= 4;
  }, null, {polling: 'raf', timeout: 10000});
  await page.evaluate(() => { delete window.__layoutTestState; });
}

async function expectSize(page, selector, axis, expected, tolerance = 2) {
  try {
    await page.waitForFunction(({selector, axis, expected, tolerance}) => {
      const n = document.querySelector(selector);
      return n && Math.abs(n.getBoundingClientRect()[axis] - expected) <= tolerance;
    }, {selector, axis, expected, tolerance}, {polling: 'raf', timeout: 10000});
    await settleLayout(page);
    const actual = await page.locator(selector).evaluate((n, axis) => n.getBoundingClientRect()[axis], axis);
    assert(Math.abs(actual - expected) <= tolerance, `${selector}: ${actual}, expected ${expected} ± ${tolerance}`);
  } catch (error) {
    const diagnostic = await page.evaluate(({selector, axis}) => {
      const n = document.querySelector(selector);
      return {selector, axis, actual: n?.getBoundingClientRect()[axis], viewport: [innerWidth, innerHeight],
        controls: [...document.querySelectorAll('.panel-splitter,[data-height]')].map(n => ({
          control: n.dataset.height || n.parentElement.className,
          min: n.getAttribute('aria-valuemin'), max: n.getAttribute('aria-valuemax'), value: n.getAttribute('aria-valuenow')
        }))};
    }, {selector, axis});
    error.message += '\n布局诊断: ' + JSON.stringify(diagnostic);
    throw error;
  }
}

async function requireRoom(handle, delta) {
  const range = await handle.evaluate(n => ({value: Number(n.getAttribute('aria-valuenow')),
    min: Number(n.getAttribute('aria-valuemin')), max: Number(n.getAttribute('aria-valuemax'))}));
  assert(range.value + delta >= range.min && range.value + delta <= range.max,
    '拖动前必须有真实可用空间: ' + JSON.stringify({delta, ...range}));
}
module.exports = {settleLayout, expectSize, requireRoom};
