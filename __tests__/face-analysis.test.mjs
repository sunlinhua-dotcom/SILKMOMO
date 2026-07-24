import assert from 'node:assert/strict';
import test from 'node:test';

test('analyzeFaceRegionAndSkin requests and parses profile pose plus exact eyewear bbox', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'face-analysis-test-key';

  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              skinTone: 'medium warm olive tan',
              faceBox2d: [180, 380, 720, 700],
              visibleFaceBox2d: [240, 390, 710, 690],
              eyewearBox2d: [300, 385, 455, 625],
              headPose: 'profile',
              occluders: ['sunglasses', 'hat brim'],
              visibility: 'partial',
              confidence: 0.91,
            }),
          }],
        },
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const assistant = await import(`../lib/ai-assistant.ts?face-analysis-test=${Date.now()}`);
    const result = await assistant.analyzeFaceRegionAndSkin('ZmFrZQ==', 'image/png');
    const prompt = requestBody.contents[0].parts[0].text;

    assert.deepEqual(result.eyewearBox2d, [300, 385, 455, 625]);
    assert.equal(result.headPose, 'profile');
    assert.match(prompt, /"eyewearBox2d"/);
    assert.match(prompt, /"headPose"/);
    assert.match(prompt, /complete.*nose bridge.*chin.*jawline/i);
    assert.match(prompt, /must not start below the eyewear/i);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
