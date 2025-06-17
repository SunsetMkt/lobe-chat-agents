import { eld } from '@yutengjing/eld';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { checkDir, readJSONSync, writeJSON } from '../utils/file';
import { Logger } from '../utils/logger';

// 语言检测器初始化Promise，确保只初始化一次
let initPromise: Promise<void> | null = null;

/**
 * 初始化 ELD 语言检测器
 * 使用中等规模的 ngram 数据集
 */
async function initializeELD(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      Logger.info('🔧 初始化 ELD 语言检测器...');
      await eld.init('M'); // 使用中等规模的数据集
      Logger.success('✅ ELD 语言检测器初始化完成');
    })();
  }
  return initPromise;
}

// ISO 639-1 to project locale code mapping
const languageMap: { [key: string]: string } = {
  en: 'en-US',
  zh: 'zh-CN',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  ru: 'ru-RU',
  ja: 'ja-JP',
  ko: 'ko-KR',
  nl: 'nl-NL',
  pl: 'pl-PL',
  tr: 'tr-TR',
  vi: 'vi-VN',
  ar: 'ar',
  th: 'th-TH',
  bg: 'bg-BG',
  uk: 'uk-UA',
  el: 'el-GR',
  he: 'he-IL',
  hi: 'hi-IN',
  hu: 'hu-HU',
  cs: 'cs-CZ',
  fi: 'fi-FI',
  da: 'da-DK',
  nb: 'nb-NO',
  sv: 'sv-SE',
  ro: 'ro-RO',
  hr: 'hr-HR',
  sk: 'sk-SK',
  sl: 'sl-SI',
  lt: 'lt-LT',
  lv: 'lv-LV',
  et: 'et-EE',
  ca: 'ca-ES',
  gl: 'gl-ES',
  eu: 'eu-ES',
  is: 'is-IS',
  mt: 'mt-MT',
  ga: 'ga-IE',
  cy: 'cy-GB',
  gd: 'gd-GB',
  br: 'br-FR',
  kw: 'kw-GB',
  fa: 'fa-IR',
  ur: 'ur-PK',
  bn: 'bn-BD',
  ta: 'ta-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  gu: 'gu-IN',
  pa: 'pa-IN',
  or: 'or-IN',
  as: 'as-IN',
  ne: 'ne-NP',
  si: 'si-LK',
  my: 'my-MM',
  km: 'km-KH',
  lo: 'lo-LA',
  ka: 'ka-GE',
  hy: 'hy-AM',
  az: 'az-AZ',
  kk: 'kk-KZ',
  ky: 'ky-KG',
  tg: 'tg-TJ',
  uz: 'uz-UZ',
  mn: 'mn-MN',
  bo: 'bo-CN',
  ug: 'ug-CN',
};

// 反向映射
const reverseLanguageMap: { [key: string]: string } = Object.fromEntries(
  Object.entries(languageMap).map(([iso, locale]) => [locale, iso]),
);

// 手动添加特殊情况的映射
reverseLanguageMap['zh-TW'] = 'zh'; // 繁体中文也映射到 zh

// i18n ignore 文件路径
const I18N_IGNORE_FILE = '.i18nignore';

// 缓存的 ignore 列表
let ignoreList: Set<string> | null = null;

export interface LanguageValidationResult {
  confidence: number;
  detectedLanguage?: string;
  expectedLanguage: string;
  filePath: string;
  fixable?: boolean;
  issues?: FieldValidationIssue[];
  valid: boolean;
}

export interface FieldValidationIssue {
  confidence: number;
  content: string;
  detectedLanguage: string;
  expectedLanguage: string;
  field: string;
}

export interface ValidationStats {
  failed: number;
  fixed: number;
  ignored: number;
  lowConfidence: number;
  passed: number;
  total: number;
}

/**
 * 读取 .i18nignore 文件
 * @returns ignore 文件列表
 */
function loadIgnoreList(): Set<string> {
  if (ignoreList !== null) {
    return ignoreList;
  }

  ignoreList = new Set<string>();

  if (existsSync(I18N_IGNORE_FILE)) {
    try {
      const content = require('node:fs').readFileSync(I18N_IGNORE_FILE, 'utf8');
      const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

      lines.forEach((line) => ignoreList!.add(line));
      Logger.info(`已加载 ${ignoreList.size} 个忽略规则`);
    } catch (error) {
      Logger.warn(`读取 ${I18N_IGNORE_FILE} 失败: ${error}`);
    }
  }

  return ignoreList;
}

/**
 * 将文件路径添加到 ignore 列表
 * @param filePath - 文件路径
 */
function addToIgnoreList(filePath: string): void {
  const ignoreSet = loadIgnoreList();
  const relativePath = filePath.replace(process.cwd() + '/', '');

  if (!ignoreSet.has(relativePath)) {
    ignoreSet.add(relativePath);

    // 写入文件
    const ignoreArray = Array.from(ignoreSet).sort();
    const content =
      ['# 语言验证忽略文件', '# 此文件中列出的路径将跳过语言验证', '', ...ignoreArray].join('\n') +
      '\n';

    try {
      require('node:fs').writeFileSync(I18N_IGNORE_FILE, content, 'utf8');
    } catch (error) {
      Logger.error(`写入 ${I18N_IGNORE_FILE} 失败: ${error}`);
    }
  }
}

/**
 * 检查文件是否在忽略列表中
 * @param filePath - 文件路径
 * @returns 是否应该忽略
 */
function isIgnored(filePath: string): boolean {
  const ignoreSet = loadIgnoreList();
  const relativePath = filePath.replace(process.cwd() + '/', '');
  return ignoreSet.has(relativePath);
}

/**
 * 确保 ELD 已初始化（公开函数，供外部调用）
 */
export async function ensureELDInitialized(): Promise<void> {
  await initializeELD();
}

/**
 * 从翻译数据中提取可检测的文本内容
 * @param data - 翻译数据对象
 * @returns 可检测的文本数组
 */
function extractDetectableText(data: any): string[] {
  const texts: string[] = [];

  function traverse(obj: any) {
    if (typeof obj === 'string' && obj.trim().length > 10) {
      texts.push(obj);
    } else if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (typeof item === 'string' && item.trim().length > 10) {
          texts.push(item);
        } else if (typeof item === 'object') {
          traverse(item);
        }
      });
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach((value) => traverse(value));
    }
  }

  traverse(data);
  return texts;
}

/**
 * 获取期望的语言代码
 * @param locale - 语言代码
 * @returns 期望的语言代码
 */
function getExpectedLanguage(locale: string): string {
  return locale.toLowerCase();
}

/**
 * 同步验证字段语言
 * @param data - 翻译数据
 * @param expectedLanguage - 期望的语言
 * @returns 字段验证问题列表
 */
function validateFieldLanguagesSync(
  data: Record<string, any>,
  expectedLanguage: string,
): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [];
  const processField = (obj: Record<string, any>, path: string = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (typeof value === 'string' && value.trim()) {
        const detection = eld.detect(value);
        const detectedLanguage = detection.language;
        const confidence = Math.max(...Object.values(detection.getScores()));

        if (detectedLanguage !== expectedLanguage || confidence < 0.4) {
          issues.push({
            field: currentPath,
            detectedLanguage: detectedLanguage || 'unknown',
            confidence,
            content: value,
            expectedLanguage,
          });
        }
      } else if (typeof value === 'object' && value !== null) {
        processField(value, currentPath);
      }
    }
  };

  processField(data);
  return issues;
}

/**
 * 验证单个翻译文件的语言
 * @param filePath - 文件路径
 * @returns 验证结果
 */
export function validateTranslationLanguage(filePath: string): LanguageValidationResult {
  try {
    // 检查文件是否存在
    if (!existsSync(filePath)) {
      return {
        filePath,
        expectedLanguage: 'unknown',
        valid: false,
        confidence: 0,
        fixable: true, // 文件不存在时标记为可修复
      };
    }

    // 检查是否在忽略列表中
    if (isIgnored(filePath)) {
      return {
        filePath,
        expectedLanguage: 'ignored',
        valid: true,
        confidence: 1,
        detectedLanguage: 'ignored',
      };
    }

    const data = readJSONSync(filePath);
    const locale =
      filePath.match(/\.([a-z]{2}-[A-Z]{2})\.json$/)?.[1] ||
      filePath.match(/\.([a-z]{2})\.json$/)?.[1];

    if (!locale) {
      return {
        filePath,
        expectedLanguage: 'unknown',
        valid: false,
        confidence: 0,
        fixable: true, // 无法识别语言时标记为可修复
      };
    }

    const expectedLanguage = getExpectedLanguage(locale);
    const texts = extractDetectableText(data);

    if (texts.length === 0) {
      return {
        filePath,
        expectedLanguage,
        valid: true,
        confidence: 1,
      };
    }

    // 检测整体语言
    const combinedText = texts.join(' ');
    const detection = eld.detect(combinedText);
    const detectedLanguage = detection.language;
    const confidence = Math.max(...Object.values(detection.getScores()));

    // 检测字段级问题
    const fieldIssues = validateFieldLanguagesSync(data, expectedLanguage);
    const hasFieldIssues = fieldIssues.length > 0;

    // 如果没有检测到语言
    if (!detectedLanguage) {
      return {
        filePath,
        expectedLanguage,
        valid: false,
        confidence: 0,
        issues: hasFieldIssues ? fieldIssues : undefined,
        fixable: true, // 无法检测语言的文件都可以用兜底修复
      };
    }

    // 语言匹配检查
    if (detectedLanguage === expectedLanguage) {
      // 即使语言匹配，如果置信度很低，也可以用兜底修复
      const isLowConfidence = confidence < 0.4;

      return {
        filePath,
        expectedLanguage,
        valid: !isLowConfidence, // 低置信度视为验证失败
        confidence,
        detectedLanguage,
        issues: hasFieldIssues ? fieldIssues : undefined,
        fixable: hasFieldIssues || isLowConfidence, // 字段问题或低置信度都可以修复
      };
    }

    // 语言不匹配
    return {
      filePath,
      expectedLanguage,
      valid: false,
      confidence,
      detectedLanguage,
      issues: hasFieldIssues ? fieldIssues : undefined,
      fixable: true, // 所有语言不匹配的文件都可以用兜底修复
    };
  } catch (error) {
    Logger.error(`验证文件失败: ${filePath} - ${error}`);
    return {
      filePath,
      expectedLanguage: 'unknown',
      valid: false,
      confidence: 0,
      fixable: true, // 验证失败时标记为可修复
    };
  }
}

/**
 * 获取对应的 en-US 兜底文件路径
 * @param filePath - 当前文件路径
 * @returns en-US 文件路径
 */
function getEnUsFallbackPath(filePath: string): string {
  // locales/agent-name/index.locale.json -> locales/agent-name/index.json
  return filePath.replace(/\.([a-z]{2}(-[A-Z]{2})?)\.json$/, '.json');
}

/**
 * 从对象中获取指定路径的值
 * @param obj - 目标对象
 * @param path - 字段路径
 * @returns 字段值
 */
function getFieldValue(obj: any, path: string): any {
  const pathParts = path.split(/[.[\]]+/).filter(Boolean);
  let current = obj;

  for (const part of pathParts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * 使用 en-US 兜底替换整个文件
 * @param filePath - 文件路径
 * @returns 是否成功修复
 */
export function fixLanguageWithFallback(filePath: string): boolean {
  try {
    const enUsPath = getEnUsFallbackPath(filePath);

    // 检查 en-US 兜底文件是否存在
    if (!existsSync(enUsPath)) {
      Logger.error(`兜底文件不存在: ${enUsPath}`);
      return false;
    }

    const enUsData = readJSONSync(enUsPath);

    // 确保目标目录存在
    checkDir(dirname(filePath));

    // 用 en-US 数据替换当前文件
    writeJSON(filePath, enUsData);

    // 将修复后的文件添加到忽略列表
    addToIgnoreList(filePath);

    Logger.success(`  使用 en-US 兜底修复: ${filePath}`);
    return true;
  } catch (error) {
    Logger.error(`兜底修复失败: ${filePath} - ${error}`);
    return false;
  }
}

/**
 * 修复翻译文件中的语言问题
 * @param filePath - 文件路径
 * @param issues - 验证问题列表
 * @returns 是否成功修复
 */
export function fixLanguageIssues(filePath: string, issues: FieldValidationIssue[]): boolean {
  try {
    const data = readJSONSync(filePath);
    const enUsPath = getEnUsFallbackPath(filePath);

    // 检查 en-US 兜底文件是否存在
    if (!existsSync(enUsPath)) {
      Logger.error(`兜底文件不存在: ${enUsPath}`);
      return false;
    }

    const enUsData = readJSONSync(enUsPath);
    let modified = false;

    for (const issue of issues) {
      // 从 en-US 文件中获取对应字段的值
      const fallbackValue = getFieldValue(enUsData, issue.field);

      if (fallbackValue !== undefined) {
        // 使用 en-US 的值替换问题字段
        const pathParts = issue.field.split(/[.[\]]+/).filter(Boolean);
        let current = data;

        // 导航到父级对象
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (current && typeof current === 'object') {
            if (!(part in current)) {
              current[part] = {};
            }
            current = current[part];
          }
        }

        // 设置字段值
        const lastKey = pathParts.at(-1);
        if (current && typeof current === 'object') {
          current[lastKey] = fallbackValue;
          Logger.info(
            `  替换字段: ${issue.field} (检测为${issue.detectedLanguage}, 用 en-US 兜底)`,
          );
          modified = true;
        }
      } else {
        Logger.warn(`  en-US 兜底文件中未找到字段: ${issue.field}`);
      }
    }

    if (modified) {
      // 确保目标目录存在
      checkDir(dirname(filePath));

      writeJSON(filePath, data);

      // 将修复后的文件添加到忽略列表
      addToIgnoreList(filePath);

      Logger.success(`  修复完成: ${filePath}`);
      return true;
    }

    return false;
  } catch (error) {
    Logger.error(`修复失败: ${filePath} - ${error}`);
    return false;
  }
}

/**
 * 获取支持的语言列表 (ELD 支持的 ISO 639-1 语言代码)
 * @returns 支持的语言代码数组
 */
export function getSupportedLanguages(): string[] {
  // ELD 支持的主要语言 (ISO 639-1 代码)
  return [
    'af',
    'ar',
    'az',
    'be',
    'bg',
    'bn',
    'bs',
    'ca',
    'cs',
    'cy',
    'da',
    'de',
    'el',
    'en',
    'eo',
    'es',
    'et',
    'eu',
    'fa',
    'fi',
    'fr',
    'ga',
    'gl',
    'gu',
    'he',
    'hi',
    'hr',
    'ht',
    'hu',
    'hy',
    'id',
    'is',
    'it',
    'ja',
    'ka',
    'kk',
    'km',
    'kn',
    'ko',
    'ku',
    'ky',
    'la',
    'lb',
    'lo',
    'lt',
    'lv',
    'mk',
    'ml',
    'mn',
    'mr',
    'ms',
    'mt',
    'my',
    'ne',
    'nl',
    'no',
    'pa',
    'pl',
    'pt',
    'ro',
    'ru',
    'si',
    'sk',
    'sl',
    'so',
    'sq',
    'sr',
    'sv',
    'sw',
    'ta',
    'te',
    'th',
    'tl',
    'tr',
    'uk',
    'ur',
    'uz',
    'vi',
    'yi',
    'zh',
  ];
}

/**
 * 检查语言是否受支持
 * @param langCode - 语言代码
 * @returns 是否支持该语言
 */
export function isLanguageSupported(langCode: string): boolean {
  return getSupportedLanguages().includes(langCode);
}
