/** 字段类型，对应飞书多维表格支持的类型 */
export type FieldType = 'text' | 'number' | 'date' | 'currency' | 'array';

/** 场景中的字段定义（OCR识别字段） */
export interface SceneField {
  /** OCR识别字段名称，如"发票号码" */
  name: string;
  /** 字段类型 */
  type: FieldType;
  /** 字段描述，用于辅助提示词 */
  description?: string;
  /** 是否启用该字段进行识别 */
  enabled?: boolean;
  /** 映射到的表格字段ID */
  tableFieldId?: string;
  /** 映射到的表格字段名（缓存，用于显示） */
  tableFieldName?: string;
  /** 子字段列表（用于表示层级关系，如"物料"包含"物料名称"、"物料编码"等） */
  children?: SceneField[];
  /** 是否是父字段（仅作为分组，不直接识别） */
  isGroup?: boolean;
}

/** 字段映射关系（用于数据写入时的转换） */
export interface FieldMapping {
  /** OCR字段名 */
  ocrFieldName: string;
  /** 表格字段ID */
  tableFieldId: string;
  /** 表格字段名 */
  tableFieldName: string;
  /** 字段类型 */
  type: FieldType;
}

/** 表格字段信息 */
export interface TableField {
  id: string;
  name: string;
  type: FieldType;
  isAttachment?: boolean;
}

/** 表格记录 */
export interface TableRecord {
  id: string;
  fields: Record<string, unknown>;
  images?: { fieldId: string; fieldName: string; urls: string[] }[];
}

/** OCR 识别场景 */
export interface Scene {
  /** 唯一标识 */
  id: string;
  /** 场景名称 */
  name: string;
  /** 场景描述 */
  description: string;
  /** 自定义提示词模板（可选，使用默认模板） */
  prompt?: string;
  /** 需要识别的字段 */
  fields: SceneField[];
  /** 是否为内置场景 */
  builtIn?: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 图片列字段ID（用于从表格批量识别） */
  imageColumnId?: string;
  /** 图片列名称（缓存） */
  imageColumnName?: string;
  /** 唯一字段列表（OCR字段名，用于更新匹配） */
  uniqueFields?: string[];
  /** 目标表格ID */
  targetTableId?: string;
  /** 未匹配时是否自动新增（默认 false） */
  autoInsertUnmatched?: boolean;
}

/** 单行识别数据 */
export type OcrRow = Record<string, string | number>;

/** OCR 识别结果 */
export interface OcrResult {
  /** 多行识别数据（每行包含单据头 + 明细字段） */
  rows: OcrRow[];
  /** 原始 AI 回复 */
  rawResponse: string;
  /** 识别耗时 (ms) */
  duration: number;
}

/** 应用设置 */
export interface AppSettings {
  /** 百炼 API Key */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** API Base URL */
  baseUrl: string;
}

/** 应用状态 */
export type AppPage = 'home' | 'scenes' | 'scene-edit' | 'settings';
