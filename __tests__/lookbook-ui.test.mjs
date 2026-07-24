import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('lookbook defaults to follow_scene and shows that option first', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');
  const optionsIndex = source.indexOf('const MODEL_IDENTITY_OPTIONS');
  const firstFollowSceneIndex = source.indexOf("id: 'follow_scene'", optionsIndex);
  const firstFreshIndex = source.indexOf("id: 'fresh'", optionsIndex);

  assert.match(source, /useState<ModelIdentityMode>\('follow_scene'\)/);
  assert.ok(firstFollowSceneIndex !== -1 && firstFreshIndex !== -1);
  assert.ok(firstFollowSceneIndex < firstFreshIndex, 'follow_scene option should render before fresh');
});

test('lookbook swap tab places model before optional accessories with contiguous numbering', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');
  const modelIndex = source.indexOf('③ 模特');
  const accessoryIndex = source.indexOf('④ 替换附件（选填）');
  const outputIndex = source.indexOf('⑤ 输出尺寸');

  assert.ok(modelIndex !== -1, 'swap tab should render ③ 模特');
  assert.ok(accessoryIndex !== -1, 'swap tab should render ④ 替换附件（选填）');
  assert.ok(outputIndex !== -1, 'swap tab should render ⑤ 输出尺寸');
  assert.ok(modelIndex < accessoryIndex, 'model section should appear before accessories');
  assert.ok(accessoryIndex < outputIndex, 'accessories should appear before output size');
});

test('pending task parameter panel hides model selectors for follow_scene group tasks', () => {
  const source = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');
  const pendingStart = source.indexOf("{project.status === 'pending' && !generating && (");
  const buttonStart = source.indexOf("{moduleType === 'product' && getShotCount() > 1 ?", pendingStart);
  const pendingPanel = source.slice(pendingStart, buttonStart);
  const modelSelectorIndex = pendingPanel.indexOf('<ModelSelector');

  assert.match(pendingPanel, /isFollowSceneGroupTask \? \(/);
  assert.match(pendingPanel, /肤色·体型·发型跟随场景图/);
  assert.ok(modelSelectorIndex !== -1, 'pending panel should still render ModelSelector for non-follow_scene tasks');
  assert.ok(
    pendingPanel.lastIndexOf('isFollowSceneGroupTask ? (', modelSelectorIndex) !== -1,
    'pending ModelSelector must be in the non-follow_scene branch',
  );
});
