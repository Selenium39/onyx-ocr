import { bitable, FieldType as BitableFieldType, IOpenCellValue, IOpenAttachment, IRecordValue } from '@lark-base-open/js-sdk';
import { Scene, FieldType, TableField, TableRecord, OcrRow, SceneField } from '../types';
import { getEnabledFields } from '../stores/scene-store';

/**
 * 获取场景的字段映射关系
 * 返回：ocr字段名 -> { tableFieldId, tableFieldName, type }
 */
async function getFieldMapping(
  scene: Scene,
  tableId?: string
): Promise<Record<string, { id: string; name: string; type: FieldType }>> {
  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  const fieldList = await table.getFieldList();
  const tableFields: Record<string, { id: string; name: string; type: BitableFieldType }> = {};

  for (const field of fieldList) {
    const name = await field.getName();
    const type = await field.getType();
    tableFields[name] = { id: field.id, name, type };
  }

  const enabledFields = getEnabledFields(scene);
  const mapping: Record<string, { id: string; name: string; type: FieldType }> = {};

  for (const sceneField of enabledFields) {
    if (sceneField.tableFieldId) {
      // 使用显式配置的映射
      const tableField = fieldList.find(f => f.id === sceneField.tableFieldId);
      if (tableField) {
        mapping[sceneField.name] = {
          id: tableField.id,
          name: await tableField.getName(),
          type: sceneField.type
        };
      }
    } else if (sceneField.tableFieldName && tableFields[sceneField.tableFieldName]) {
      // 使用显式配置的字段名
      const tf = tableFields[sceneField.tableFieldName];
      mapping[sceneField.name] = {
        id: tf.id,
        name: tf.name,
        type: sceneField.type
      };
    } else if (tableFields[sceneField.name]) {
      // 默认：找同名字段
      const tf = tableFields[sceneField.name];
      mapping[sceneField.name] = {
        id: tf.id,
        name: tf.name,
        type: sceneField.type
      };
    }
  }

  return mapping;
}

/**
 * 将插件的字段类型映射为飞书多维表格字段类型
 */
function mapFieldType(type: FieldType): BitableFieldType {
  switch (type) {
    case 'number':
      return BitableFieldType.Number;
    case 'currency':
      return BitableFieldType.Currency;
    case 'date':
      return BitableFieldType.DateTime;
    case 'text':
    default:
      return BitableFieldType.Text;
  }
}

/**
 * 获取默认值（用于创建字段）
 */
function getDefaultValue(type: FieldType): unknown {
  switch (type) {
    case 'number':
    case 'currency':
      return 0;
    case 'date':
      return Date.now();
    case 'text':
    default:
      return [{ type: 'text', text: '' }];
  }
}

/**
 * 将飞书字段类型映射为插件字段类型
 */
function mapBitableFieldType(type: BitableFieldType): FieldType {
  switch (type) {
    case BitableFieldType.Number:
      return 'number';
    case BitableFieldType.Currency:
      return 'currency';
    case BitableFieldType.DateTime:
    case BitableFieldType.CreatedTime:
    case BitableFieldType.ModifiedTime:
      return 'date';
    case BitableFieldType.Text:
    case BitableFieldType.SingleSelect:
    case BitableFieldType.MultiSelect:
    case BitableFieldType.Url:
    default:
      return 'text';
  }
}

/**
 * 获取当前活动的数据表
 */
export async function getActiveTable() {
  const selection = await bitable.base.getSelection();
  if (!selection.tableId) {
    throw new Error('请先选择一个数据表');
  }
  return bitable.base.getTableById(selection.tableId);
}

/**
 * 获取所有数据表列表
 */
export async function getTableList() {
  const tableList = await bitable.base.getTableList();
  const result: { id: string; name: string }[] = [];
  for (const table of tableList) {
    const name = await table.getName();
    result.push({ id: table.id, name });
  }
  return result;
}

/**
 * 获取指定表格的所有字段
 */
export async function getTableFields(tableId?: string): Promise<TableField[]> {
  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  const fieldList = await table.getFieldList();
  const fields: TableField[] = [];

  for (const field of fieldList) {
    const type = await field.getType();
    fields.push({
      id: field.id,
      name: await field.getName(),
      type: mapBitableFieldType(type),
      isAttachment: type === BitableFieldType.Attachment,
    });
  }

  return fields;
}

/**
 * 获取表格中的所有记录
 * 使用分页获取，避免单次请求过多记录
 */
export async function getTableRecords(tableId?: string): Promise<TableRecord[]> {
  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  const allRecords: TableRecord[] = [];
  let hasMore = true;
  let pageToken: number | undefined;

  while (hasMore) {
    const result = await table.getRecordsByPage({
      pageToken,
      pageSize: 200, // 每页最多 200 条
    });

    allRecords.push(
      ...result.records.map((r) => ({
        id: r.recordId,
        fields: r.fields as Record<string, unknown>,
      }))
    );

    hasMore = result.hasMore;
    pageToken = result.pageToken;

    // 安全限制，最多获取 1000 条
    if (allRecords.length >= 1000) {
      break;
    }
  }

  return allRecords;
}

/**
 * 获取单条记录中的图片附件URL列表（单条查询用）
 */
export async function getRecordImages(
  recordId: string,
  imageFieldIdOrName: string,
  tableId?: string
): Promise<string[]> {
  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  const attachmentField = await findAttachmentField(table, imageFieldIdOrName);
  if (!attachmentField) return [];

  try {
    const cellValue = await table.getCellValue(attachmentField.id, recordId);
    if (!cellValue || (Array.isArray(cellValue) && cellValue.length === 0)) {
      return [];
    }

    const urls = await (attachmentField as unknown as { getAttachmentUrls: (recordId: string) => Promise<string[]> }).getAttachmentUrls(recordId);
    return urls || [];
  } catch (error) {
    console.error(`[getRecordImages] 获取附件 URL 失败:`, error);
    return [];
  }
}

/**
 * 在字段列表中查找附件字段（按 ID 优先，按名称兜底）
 */
async function findAttachmentField(
  table: Awaited<ReturnType<typeof getActiveTable>>,
  imageFieldIdOrName: string
) {
  const fieldList = await table.getFieldList();

  for (const field of fieldList) {
    if (field.id === imageFieldIdOrName) {
      const type = await field.getType();
      return type === BitableFieldType.Attachment ? field : null;
    }
  }

  for (const field of fieldList) {
    const name = await field.getName();
    if (name === imageFieldIdOrName) {
      const type = await field.getType();
      return type === BitableFieldType.Attachment ? field : null;
    }
  }

  return null;
}

/**
 * 批量扫描所有记录，高效返回有图片附件的记录及其 URL
 *  - 字段列表只查一次
 *  - 利用 getRecordsByPage 返回的 fields 预筛有附件的记录
 *  - 只对有附件的记录调用 getAttachmentUrls
 *  - 无记录数上限
 */
export async function getRecordsWithImages(
  imageFieldId: string,
  tableId?: string
): Promise<{ recordId: string; urls: string[] }[]> {
  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  const attachmentField = await findAttachmentField(table, imageFieldId);
  if (!attachmentField) {
    console.warn(`[getRecordsWithImages] 未找到附件字段: ${imageFieldId}`);
    return [];
  }

  const fieldId = attachmentField.id;
  const candidateRecordIds: string[] = [];
  let hasMore = true;
  let pageToken: number | undefined;
  let totalRecords = 0;
  let debugSampled = false;

  while (hasMore) {
    const result = await table.getRecordsByPage({ pageToken, pageSize: 200 });
    totalRecords += result.records.length;

    for (const r of result.records) {
      const cellValue = r.fields[fieldId];

      if (!debugSampled && cellValue) {
        console.log(`[getRecordsWithImages] 样本附件值 recordId=${r.recordId}:`, JSON.stringify(cellValue).slice(0, 300));
        debugSampled = true;
      }

      if (cellValue && Array.isArray(cellValue) && cellValue.length > 0) {
        candidateRecordIds.push(r.recordId);
      }
    }

    hasMore = result.hasMore;
    pageToken = result.pageToken;
  }

  console.log(`[getRecordsWithImages] 扫描 ${totalRecords} 条记录，发现 ${candidateRecordIds.length} 条有附件`);

  const results: { recordId: string; urls: string[] }[] = [];

  for (const recordId of candidateRecordIds) {
    try {
      const urls = await (attachmentField as unknown as { getAttachmentUrls: (recordId: string) => Promise<string[]> }).getAttachmentUrls(recordId);
      if (urls && urls.length > 0) {
        results.push({ recordId, urls });
      }
    } catch (error) {
      console.error(`[getRecordsWithImages] recordId=${recordId} 获取URL失败:`, error);
    }
  }

  return results;
}

/**
 * 确保表格中有对应字段，如果不存在则创建
 * 优先使用 sceneField 中指定的 tableFieldId 或 tableFieldName
 * 支持层级字段（扁平化处理）
 * 返回 ocrFieldName -> fieldId 的映射
 */
export async function ensureFields(
  scene: Scene,
  tableId?: string
): Promise<Record<string, string>> {
  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  const fieldList = await table.getFieldList();
  const existingFieldsByName: Record<string, string> = {};
  const existingFieldsById: Record<string, string> = {};

  for (const field of fieldList) {
    const name = await field.getName();
    existingFieldsByName[name] = field.id;
    existingFieldsById[field.id] = field.id;
  }

  const enabledFields = getEnabledFields(scene);
  // 扁平化字段映射（处理层级字段）
  const flattenedMappings = flattenFieldMappings(enabledFields);
  const fieldMap: Record<string, string> = {};

  for (const mapping of flattenedMappings) {
    let fieldId: string | undefined;

    // 优先使用显式配置的 tableFieldId
    if (mapping.tableFieldId && existingFieldsById[mapping.tableFieldId]) {
      fieldId = mapping.tableFieldId;
    }
    // 其次使用 tableFieldName 查找
    else if (mapping.tableFieldName && existingFieldsByName[mapping.tableFieldName]) {
      fieldId = existingFieldsByName[mapping.tableFieldName];
    }
    // 最后使用 ocr 字段名（扁平化后的名称如 "物料.物料名称"）查找
    else if (existingFieldsByName[mapping.name]) {
      fieldId = existingFieldsByName[mapping.name];
    }

    if (fieldId) {
      fieldMap[mapping.name] = fieldId;
    } else {
      // 字段不存在，创建新字段（使用扁平化后的 ocr 字段名）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newFieldId = await table.addField({
        type: mapFieldType(mapping.type) as unknown as BitableFieldType.Text,
        name: mapping.name,
      } as any);
      fieldMap[mapping.name] = newFieldId;
    }
  }

  return fieldMap;
}

/**
 * 根据唯一字段查找记录
 * 返回匹配的记录ID列表
 * 注意：飞书 SDK 没有 getRecordsByFilter，我们获取所有记录后在内存中过滤
 */
export async function findRecordsByUniqueFields(
  uniqueFields: string[],
  data: Record<string, string | number>,
  fieldMap: Record<string, string>,
  tableId?: string
): Promise<string[]> {
  if (uniqueFields.length === 0) return [];

  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  // 获取所有记录ID（限制最多 2000 条）
  const recordIds: string[] = [];
  let hasMore = true;
  let pageToken: number | undefined;

  while (hasMore && recordIds.length < 2000) {
    const result = await table.getRecordIdListByPage({
      pageToken,
      pageSize: 200,
    });
    recordIds.push(...result.recordIds);
    hasMore = result.hasMore;
    pageToken = result.pageToken;
  }

  if (recordIds.length === 0) return [];

  // 批量获取记录内容
  const matchedIds: string[] = [];

  // 分批获取记录（每次最多 50 条，避免超过限制）
  for (let i = 0; i < recordIds.length; i += 50) {
    const batch = recordIds.slice(i, i + 50);
    const records = await table.getRecordsByIds(batch);

    for (let idx = 0; idx < records.length; idx++) {
      const record = records[idx];
      const recordId = batch[idx];
      const fields = record.fields as Record<string, unknown>;
      let isMatch = true;

      for (const ocrFieldName of uniqueFields) {
        const fieldId = fieldMap[ocrFieldName];
        const expectedValue = String(data[ocrFieldName] ?? '');

        if (!fieldId) {
          // 唯一字段在 fieldMap 中找不到，视为不匹配（避免因跳过导致误匹配）
          isMatch = false;
          break;
        }

        // 获取字段值
        const cellValue = fields[fieldId];
        let actualValue = '';

        if (cellValue !== null && cellValue !== undefined) {
          if (Array.isArray(cellValue) && cellValue.length > 0) {
            // 多行文本等数组类型
            actualValue = String((cellValue[0] as { text?: string })?.text ?? cellValue[0] ?? '');
          } else {
            actualValue = String(cellValue);
          }
        }

        if (actualValue !== expectedValue) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        matchedIds.push(recordId);
      }
    }
  }

  return matchedIds;
}

/**
 * 将数据转换为飞书单元格值
 */
function convertToCellValue(
  value: string | number | undefined,
  fieldType: FieldType
): IOpenCellValue | undefined {
  if (value === '' || value === undefined || value === null) return undefined;

  switch (fieldType) {
    case 'text':
      return [{ type: 'text', text: String(value) }] as unknown as IOpenCellValue;
    case 'number':
    case 'currency':
      return typeof value === 'number' ? value : parseFloat(String(value)) || 0;
    case 'date': {
      const timestamp = new Date(String(value)).getTime();
      if (!isNaN(timestamp)) return timestamp;
      return undefined;
    }
    default:
      return String(value) as unknown as IOpenCellValue;
  }
}

/**
 * 递归扁平化字段类型映射
 * 例如：{ "物料": { "物料名称": "A" } } 会生成 { "物料.物料名称": "text" }
 */
function flattenFieldTypeMap(
  fields: SceneField[],
  prefix = ''
): Record<string, FieldType> {
  const typeMap: Record<string, FieldType> = {};

  for (const field of fields) {
    const fieldName = prefix ? `${prefix}.${field.name}` : field.name;

    if (field.children && field.children.length > 0) {
      // 父字段 - 递归处理子字段
      const childMap = flattenFieldTypeMap(field.children, fieldName);
      Object.assign(typeMap, childMap);
    } else {
      // 普通字段
      typeMap[fieldName] = field.type;
    }
  }

  return typeMap;
}

/**
 * 递归扁平化字段映射（包含 tableFieldId/tableFieldName）
 */
function flattenFieldMappings(
  fields: SceneField[],
  prefix = ''
): Array<{ name: string; tableFieldId?: string; tableFieldName?: string; type: FieldType }> {
  const mappings: Array<{ name: string; tableFieldId?: string; tableFieldName?: string; type: FieldType }> = [];

  for (const field of fields) {
    const fieldName = prefix ? `${prefix}.${field.name}` : field.name;

    if (field.children && field.children.length > 0) {
      // 父字段 - 递归处理子字段
      const childMappings = flattenFieldMappings(field.children, fieldName);
      mappings.push(...childMappings);
    } else {
      // 普通字段
      mappings.push({
        name: fieldName,
        tableFieldId: field.tableFieldId,
        tableFieldName: field.tableFieldName,
        type: field.type,
      });
    }
  }

  return mappings;
}

/**
 * 获取字段类型映射（包含层级字段扁平化后的结果）
 * 返回 ocrFieldName -> FieldType 的映射
 */
function getFieldTypeMap(scene: Scene): Record<string, FieldType> {
  const enabledFields = getEnabledFields(scene);
  return flattenFieldTypeMap(enabledFields);
}

/**
 * 更新记录
 */
export async function updateRecord(
  recordId: string,
  data: Record<string, string | number>,
  fieldMap: Record<string, string>,
  scene: Scene,
  tableId?: string
): Promise<void> {
  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  const fieldTypeMap = getFieldTypeMap(scene);
  const fields: Record<string, IOpenCellValue> = {};

  for (const [ocrFieldName, fieldId] of Object.entries(fieldMap)) {
    const value = data[ocrFieldName];
    const fieldType = fieldTypeMap[ocrFieldName] || 'text';
    const cellValue = convertToCellValue(value, fieldType);

    if (fieldId && cellValue !== undefined) {
      fields[fieldId] = cellValue;
    }
  }

  await table.setRecord(recordId, { fields });
}

/**
 * 将 OCR 结果写入多维表格（插入新记录）
 */
export async function insertRecord(
  data: Record<string, string | number>,
  fieldMap: Record<string, string>,
  scene: Scene,
  tableId?: string
): Promise<string> {
  const table = tableId
    ? await bitable.base.getTableById(tableId)
    : await getActiveTable();

  const fieldTypeMap = getFieldTypeMap(scene);
  const fields: Record<string, IOpenCellValue> = {};

  for (const [ocrFieldName, fieldId] of Object.entries(fieldMap)) {
    const value = data[ocrFieldName];
    const fieldType = fieldTypeMap[ocrFieldName] || 'text';
    const cellValue = convertToCellValue(value, fieldType);

    if (fieldId && cellValue !== undefined) {
      fields[fieldId] = cellValue;
    }
  }

  const recordId = await table.addRecord({ fields });
  return recordId;
}

/**
 * 插入或更新记录
 * 如果设置了 uniqueFields，则根据唯一字段查找匹配记录，更新或插入
 * 返回 { updated: 更新数量, inserted: 插入数量 }
 */
export async function upsertRecords(
  dataList: Record<string, string | number>[],
  fieldMap: Record<string, string>,
  scene: Scene,
  tableId?: string
): Promise<{ updated: number; inserted: number; total: number }> {
  const uniqueFields = scene.uniqueFields || [];
  let updated = 0;
  let inserted = 0;

  for (const data of dataList) {
    if (uniqueFields.length > 0) {
      // 查找匹配记录
      const matchedIds = await findRecordsByUniqueFields(
        uniqueFields,
        data,
        fieldMap,
        tableId
      );

      if (matchedIds.length > 0) {
        // 更新第一条匹配记录
        await updateRecord(matchedIds[0], data, fieldMap, scene, tableId);
        updated++;
        continue;
      }
    }

    // 没有匹配或没有唯一字段，插入新记录
    await insertRecord(data, fieldMap, scene, tableId);
    inserted++;
  }

  return { updated, inserted, total: dataList.length };
}

/**
 * 批量写入多条记录（兼容旧接口，使用插入模式）
 */
export async function insertRecords(
  dataList: Record<string, string | number>[],
  fieldMap: Record<string, string>,
  scene: Scene,
  tableId?: string
): Promise<string[]> {
  const ids: string[] = [];
  for (const data of dataList) {
    ids.push(await insertRecord(data, fieldMap, scene, tableId));
  }
  return ids;
}
