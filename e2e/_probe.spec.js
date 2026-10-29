// 临时探针（gitignored）：暗色「离边卡面 vs 桌面」在不同 desk-lit / glass-fill / 纸纹 下的差
const { test } = require('@playwright/test');
const { stubCdn, seed, waitReady, sampleState, disableMotion, samplePixels, pixelLum } = require('./fixtures');

test('probe: dark variants', async ({ page }) => {
  await disableMotion(page);
  await stubCdn(page);
  await seed(page, sampleState());
  await page.goto('index.html');
  await waitReady(page);
  const geom = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.card')].filter((c) => c.getBoundingClientRect().width > 900)[0];
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y + b.height * 0.55) };
  });
  const deskOffsets = [-16, -26, -36, -46, -66];
  const cardOffsets = [20, 40, 60, 80];
  const measure = async () => {
    const px = await samplePixels(page, [
      ...deskOffsets.map((d) => [geom.x + d, geom.y]),
      ...cardOffsets.map((d) => [geom.x + d, geom.y]),
    ]);
    const body = px.map(pixelLum);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const desk = avg(body.slice(0, deskOffsets.length));
    const card = avg(body.slice(deskOffsets.length));
    return { desk: +desk.toFixed(4), card: +card.toFixed(4), gap: +(card - desk).toFixed(4) };
  };
  const setVar = (name, value) => page.evaluate(([n, v]) => {
    document.documentElement.style.setProperty(n, v);
  }, [name, value]);
  console.log('LIGHT', JSON.stringify(await measure()));
  await page.evaluate(() => setTheme(true));
  console.log('DARK base', JSON.stringify(await measure()));
  for (const lit of ['0.06', '0.045', '0.03']) {
    await setVar('--desk-lit', `rgba(255, 240, 200, ${lit})`);
    console.log('lit ' + lit, JSON.stringify(await measure()));
  }
  await setVar('--desk-lit', 'rgba(255, 240, 200, 0.045)');
  for (const fill of ['rgba(66, 54, 35, 0.40)', 'rgba(74, 60, 38, 0.40)', 'rgba(74, 60, 38, 0.42)']) {
    await setVar('--glass-fill', fill);
    console.log('fill ' + fill, JSON.stringify(await measure()));
  }
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.dark body::before, .dark .app-header::after { opacity: 0.07 !important; }';
    document.head.appendChild(s);
  });
  console.log('fill 74 + grain .07', JSON.stringify(await measure()));
});
