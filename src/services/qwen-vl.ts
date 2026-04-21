import OpenAI from 'openai';
import { Scene, OcrResult, OcrRow, AppSettings, SceneField } from '../types';
import { getEnabledFields, getScenePrompt } from '../stores/scene-store';

/**
 * 递归构建字段 JSON 行
 * 数组对象类型输出为数组格式
 */
function buildFieldLines(fields: SceneField[], indent: string): string {
  return fields
    .filter((f) => f.enabled !== false)
    .map((f) => {
      const desc = f.description ? ` // ${f.description}` : '';
      if (f.type === 'array' || (f.children && f.children.length > 0)) {
        // 数组对象类型 - 输出为数组格式
        const childLines = buildFieldLines(f.children || [], indent + '    ');
        return `${indent}"${f.name}": [
${indent}  {
${childLines}
${indent}  }
${indent}]${desc}`;
      } else {
        // 普通字段
        return `${indent}"${f.name}": ""${desc}`;
      }
    })
    .join(',\n');
}

/**
 * 根据场景字段生成 JSON 格式说明
 * 支持多行数据（数组格式）和层级字段
 */
function buildFieldsPlaceholder(scene: Scene): string {
  const enabledFields = getEnabledFields(scene);
  const fieldLines = buildFieldLines(enabledFields, '  ');

  return `{
${fieldLines}
}`;
}

/**
 * 构建完整的 prompt
 */
export function buildPrompt(scene: Scene): string {
  const fieldsJson = buildFieldsPlaceholder(scene);
  const promptTemplate = getScenePrompt(scene);
  return promptTemplate.replace('{fields_placeholder}', fieldsJson);
}

/**
 * 将图片文件转为 base64 data URL
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 从 URL 下载图片并转为 base64
 * 支持飞书多维表格附件 URL
 */
export async function urlToBase64(url: string): Promise<string> {
  try {
    console.log('[urlToBase64] 下载:', url);
    const response = await fetch(url, {
      credentials: 'include', // 包含 cookie，用于飞书认证
    });
    if (!response.ok) {
      throw new Error(`下载图片失败: ${response.status} ${response.statusText}`);
    }

    // 检查 Content-Type
    const contentType = response.headers.get('Content-Type') || '';
    console.log('[urlToBase64] Content-Type:', contentType);

    // 如果不是图片类型，可能是错误页面
    if (!contentType.startsWith('image/')) {
      const text = await response.text();
      console.error('[urlToBase64] 返回的不是图片:', text.substring(0, 500));
      throw new Error(`返回的不是图片，Content-Type: ${contentType}`);
    }

    const blob = await response.blob();
    console.log('[urlToBase64] 下载成功，size:', blob.size);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader 失败'));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('[urlToBase64] 下载失败:', url, error);
    throw error;
  }
}

/**
 * 调用 Qwen-VL 模型进行 OCR 识别
 */
export async function recognizeImage(
  settings: AppSettings,
  scene: Scene,
  imageBase64: string
): Promise<OcrResult> {
  const client = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl,
    dangerouslyAllowBrowser: true,
  });

  const prompt = buildPrompt(scene);
  const startTime = Date.now();

  const completion = await client.chat.completions.create({
    model: settings.model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageBase64 },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  const duration = Date.now() - startTime;
  const rawResponse = completion.choices[0]?.message?.content || '';

  // 从回复中提取 JSON 并展开为多行
  const rows = parseJsonResponse(rawResponse, scene);

  return { rows, rawResponse, duration };
}

/**
 * 对字段值进行类型转换
 */
function convertFieldValue(
  value: any,
  fieldType: string
): string | number {
  if (value === undefined || value === null) return '';
  if (
    (fieldType === 'number' || fieldType === 'currency') &&
    typeof value === 'string'
  ) {
    const num = parseFloat(value.replace(/[,，]/g, ''));
    return isNaN(num) ? value : num;
  }
  return value;
}

/**
 * 递归扁平化字段值（处理层级字段）
 * 支持数组对象类型（多行明细数据）
 * 例如：{ "物料": { "物料名称": "A", "物料编码": "001" } } => { "物料.物料名称": "A", "物料.物料编码": "001" }
 */
function flattenFieldValues(
  item: Record<string, unknown>,
  field: SceneField,
  prefix = ''
): Record<string, string | number>[] {
  const fieldName = prefix ? `${prefix}.${field.name}` : field.name;

  // 数组对象类型 - 展开为多行
  if (field.type === 'array' || (field.children && field.children.length > 0)) {
    const value = item[field.name];
    const childFields = field.children || [];

    // 如果值是数组，展开为多个对象
    if (Array.isArray(value)) {
      const rows: Record<string, string | number>[] = [];
      for (const element of value) {
        if (element && typeof element === 'object') {
          const childObj = element as Record<string, unknown>;
          // 收集所有子字段的结果，按最大长度做笛卡尔积展开
          const childFieldResults: Record<string, Record<string, string | number>[]> = {};
          let maxChildLength = 1;

          for (const child of childFields) {
            const childResults = flattenFieldValues(childObj, child, fieldName);
            childFieldResults[child.name] = childResults;
            if (childResults.length > maxChildLength) {
              maxChildLength = childResults.length;
            }
          }

          for (let i = 0; i < maxChildLength; i++) {
            const row: Record<string, string | number> = {};
            for (const child of childFields) {
              const results = childFieldResults[child.name];
              const fieldData = results[i] || results[0] || {};
              Object.assign(row, fieldData);
            }
            rows.push(row);
          }
        }
      }
      return rows.length > 0 ? rows : [{}];
    }

    // 如果值是对象（单条记录），也包装为数组
    if (value && typeof value === 'object') {
      const childObj = value as Record<string, unknown>;
      const childFieldResults: Record<string, Record<string, string | number>[]> = {};
      let maxChildLength = 1;

      for (const child of childFields) {
        const childResults = flattenFieldValues(childObj, child, fieldName);
        childFieldResults[child.name] = childResults;
        if (childResults.length > maxChildLength) {
          maxChildLength = childResults.length;
        }
      }

      const rows: Record<string, string | number>[] = [];
      for (let i = 0; i < maxChildLength; i++) {
        const row: Record<string, string | number> = {};
        for (const child of childFields) {
          const results = childFieldResults[child.name];
          const fieldData = results[i] || results[0] || {};
          Object.assign(row, fieldData);
        }
        rows.push(row);
      }
      return rows;
    }

    // 空值返回空对象数组
    return [{}];
  }

  // 普通字段 - 返回单元素数组以保持接口一致
  return [{ [fieldName]: convertFieldValue(item[field.name], field.type) }];
}

/**
 * 从 AI 回复中解析 JSON 数据
 * 支持：
 * 1. 单行数据对象 { "字段": "值", ... }
 * 2. 数组对象类型自动展开为多行（如物料明细）
 * 3. 层级字段自动扁平化为 "父字段.子字段" 格式
 */
function parseJsonResponse(response: string, scene: Scene): OcrRow[] {
  const enabledFields = getEnabledFields(scene);

  // 尝试提取 JSON 块
  let jsonStr = response;

  // 尝试从 markdown 代码块中提取
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else {
    // 尝试找到第一个 { 或 [ 和最后一个 } 或 ]
    const firstBrace = response.indexOf('{');
    const firstBracket = response.indexOf('[');
    const start = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)
      ? firstBracket : firstBrace;
    const lastBrace = response.lastIndexOf('}');
    const lastBracket = response.lastIndexOf(']');
    const end = lastBracket !== -1 && (lastBrace === -1 || lastBracket > lastBrace)
      ? lastBracket : lastBrace;
    if (start !== -1 && end !== -1) {
      jsonStr = response.substring(start, end + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    let items: unknown[];

    // 如果返回的是数组，直接使用
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed.items && Array.isArray(parsed.items)) {
      // 如果返回的是对象，检查是否有 items 字段
      items = parsed.items;
    } else {
      // 单行数据（没有 items 数组）
      items = [parsed];
    }

    // 处理每一行数据
    // 处理数组对象类型展开：如果存在数组对象类型的字段，需要将其展开为多行
    const rows: OcrRow[] = [];

    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;

      const itemObj = item as Record<string, unknown>;

      // 收集所有字段的值（普通字段是单值，数组字段是多值）
      const fieldResults: Record<string, Record<string, string | number>[]> = {};
      let maxArrayLength = 1; // 最小行数

      for (const field of enabledFields) {
        const results = flattenFieldValues(itemObj, field);
        fieldResults[field.name] = results;
        if (results.length > maxArrayLength) {
          maxArrayLength = results.length;
        }
      }

      // 生成多行数据（笛卡尔积展开）
      for (let i = 0; i < maxArrayLength; i++) {
        const row: OcrRow = {};
        for (const field of enabledFields) {
          const results = fieldResults[field.name];
          // 如果有多个值，取第i个，否则取第一个（或者空对象）
          const fieldData = results[i] || results[0] || {};
          Object.assign(row, fieldData);
        }
        rows.push(row);
      }
    }

    return rows.length > 0 ? rows : [createEmptyRow(enabledFields)];
  } catch {
    // 解析失败则返回空行
    return [createEmptyRow(enabledFields)];
  }
}

/**
 * 创建空行数据
 */
function createEmptyRow(fields: SceneField[]): OcrRow {
  const row: OcrRow = {};
  for (const field of fields) {
    if (field.type === 'array' || (field.children && field.children.length > 0)) {
      for (const child of field.children || []) {
        row[`${field.name}.${child.name}`] = '';
      }
    } else {
      row[field.name] = '';
    }
  }
  return row;
}
