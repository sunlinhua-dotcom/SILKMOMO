import assert from 'node:assert/strict';
import test from 'node:test';

const faceSwap = await import('../lib/face-swap.ts');

test('parseFaceSwap302Response extracts direct image URLs', () => {
  assert.deepEqual(
    faceSwap.parseFaceSwap302Response({
      image: {
        url: 'https://file.302.ai/gpt/imgs/direct.jpg',
        width: 1080,
        height: 1350,
      },
    }),
    { imageUrl: 'https://file.302.ai/gpt/imgs/direct.jpg' },
  );

  assert.deepEqual(
    faceSwap.parseFaceSwap302Response({
      data: {
        images: [{ url: 'https://file.302.ai/gpt/imgs/from-array.jpg' }],
      },
    }),
    { imageUrl: 'https://file.302.ai/gpt/imgs/from-array.jpg' },
  );
});

test('parseFaceSwap302Response extracts task ids from documented task shapes', () => {
  assert.deepEqual(
    faceSwap.parseFaceSwap302Response({
      task_id: 'task-from-snake-case',
      status: 'queued',
    }),
    { taskId: 'task-from-snake-case', status: 'queued' },
  );

  assert.deepEqual(
    faceSwap.parseFaceSwap302Response({
      data: {
        task: {
          id: 'nested-task-id',
          status: 'processing',
        },
      },
    }),
    { taskId: 'nested-task-id', status: 'processing' },
  );
});
