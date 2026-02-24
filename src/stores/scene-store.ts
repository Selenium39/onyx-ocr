import { Scene, AppSettings, SceneField } from '../types';

const SCENES_KEY = 'onyx-ocr-scenes';
const SETTINGS_KEY = 'onyx-ocr-settings';

/** 默认提示词模板 */
export const DEFAULT_PROMPT_TEMPLATE = `请仔细识别这张图片中的信息。按以下 JSON 格式返回识别结果，不要包含任何其他文字说明：
{fields_placeholder}

注意事项：
1. 金额和数量类字段请返回纯数字（不含货币符号和千分位分隔符）
2. 日期格式请统一为 YYYY-MM-DD
3. 如果某个字段无法识别，请填写空字符串 ""，不要返回 null
4. 只返回 JSON，不要有其他内容如 markdown 标记或解释文字`;

/** 递归获取启用的字段 */
function getEnabledFieldsRecursive(fields: SceneField[]): SceneField[] {
  return fields
    .filter((f) => f.enabled !== false)
    .map((f) => ({
      ...f,
      children: f.children ? getEnabledFieldsRecursive(f.children) : undefined,
    }));
}

/** 获取场景的有效字段（启用的字段，包含子字段） */
export function getEnabledFields(scene: Scene): SceneField[] {
  return getEnabledFieldsRecursive(scene.fields);
}

/** 获取场景的提示词（使用自定义或默认） */
export function getScenePrompt(scene: Scene): string {
  return scene.prompt || DEFAULT_PROMPT_TEMPLATE;
}

/** 获取所有场景 */
export function getScenes(): Scene[] {
  const stored = localStorage.getItem(SCENES_KEY);
  return stored ? JSON.parse(stored) : [];
}

/** 保存场景 */
export function saveScenes(scenes: Scene[]): void {
  localStorage.setItem(SCENES_KEY, JSON.stringify(scenes));
}

/** 获取场景 */
export function getSceneById(id: string): Scene | undefined {
  return getScenes().find((s) => s.id === id);
}

/** 添加或更新场景 */
export function upsertScene(scene: Scene): void {
  const scenes = getScenes();
  const idx = scenes.findIndex((s) => s.id === scene.id);
  if (idx >= 0) {
    scenes[idx] = { ...scene, updatedAt: Date.now() };
  } else {
    scenes.push({ ...scene, createdAt: Date.now(), updatedAt: Date.now() });
  }
  saveScenes(scenes);
}

/** 删除场景 */
export function deleteScene(id: string): void {
  const scenes = getScenes().filter((s) => s.id !== id);
  saveScenes(scenes);
}

/** 默认设置 */
const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  model: 'qwen3-vl-plus',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

/** 获取设置 */
export function getSettings(): AppSettings {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (stored) {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  }
  return DEFAULT_SETTINGS;
}

/** 保存设置 */
export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
