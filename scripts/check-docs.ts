// `npm run check:docs`: each doc the person reads has a Simplified Chinese side that stays in step with its
// English side, and every other doc is listed as unpaired (docs/agents/doc-pairs.md). The pre-commit hook and CI
// run it.
import { join } from 'node:path';
import { checkDocs, type Rendering } from './doc-pairs.ts';

/** The paired docs, each named by its English side, and `docs/adr/`, where every ADR is a pair. */
const PAIRS = ['CONTEXT.md', 'bot/README.md', 'browser/README.md', 'ops/README.md', 'docs/hooks-and-ci.md', 'docs/adr/'];

/**
 * The docs with no Chinese side, each a file or a directory covering everything under it: agent instructions, test
 * fixtures, the course's brief as received, and other sessions' worktrees.
 */
const UNPAIRED = [
  'AGENTS.md',
  'CLAUDE.md',
  'CODING_STANDARDS.md',
  '.claude/skills/',
  'docs/agents/',
  'bot/test/fixtures/',
  'docs/lab1.md',
  '.claude/worktrees/',
];

/**
 * The one Chinese rendering of each phrase the English sides use in one sense. `except` holds wording that uses the
 * phrase in another sense, which the entry lets through. docs/agents/doc-pairs.md says what belongs here.
 */
const RENDERINGS: Rendering[] = [
  { en: 'plain code', zh: '普通代码' },
  { en: 'fill run', zh: '填表运行' },
  { en: 'ledger', zh: '台账' },
  { en: 'gate', zh: '门禁', except: ['a gate between runs'] },
  { en: 'the person', zh: '这个人' },
  { en: 'bot', zh: '机器人' },
  { en: 'browser service', zh: '浏览器服务' },
  { en: 'live store', zh: '实时存储' },
  { en: 'by reference', zh: '按引用' },
  { en: 'coding session', zh: '编码会话' },
  { en: 'bot check', zh: '机器人检测', except: ['the bot checks'] },
  { en: 'spending budget', zh: '花费预算' },
  { en: 'signup page', zh: '注册页' },
  { en: 'fast-forward', zh: '快进' },
  { en: 'page check', zh: '页面检查' },
  { en: 'Submit tap', zh: 'Submit 点按', except: ['one Submit tap on Discord'] },
  { en: 'amended Walkthrough', zh: '修订后的 Walkthrough' },
  { en: 'verification link', zh: '验证链接' },
  { en: 'spec', zh: '规格' },
  { en: 'dry run', zh: '试运行' },
  { en: 'root domain', zh: '根域名' },
  { en: 'plus-address', zh: '加号地址' },
  { en: 'Docker helper', zh: '辅助程序' },
  { en: 'raw input', zh: '原始输入' },
  { en: 'carry-over check', zh: '延续检查' },
  { en: 'smoke test', zh: '冒烟测试' },
  { en: 'model route', zh: '模型路线' },
  { en: 'host firewall', zh: '主机防火墙' },
  { en: 'top-level page', zh: '顶层页面' },
  { en: 'browser image', zh: '浏览器镜像' },
  { en: 'silent line', zh: '静默消息' },
  { en: 'role key', zh: '角色密钥' },
  { en: 'card field', zh: '银行卡字段' },
  { en: 'model request', zh: '模型请求' },
  { en: 'page text', zh: '页面文本' },
  { en: 'Pacific day', zh: '太平洋时间日' },
  { en: 'notional dollar', zh: '名义美元' },
  { en: 'fixed action', zh: '固定动作' },
  { en: 'drop out', zh: '掉线' },
  { en: 'drops out', zh: '掉线' },
  { en: 'dropped out', zh: '掉线' },
  { en: 'dropping out', zh: '掉线' },
  { en: 'out of balance', zh: '余额不足' },
  { en: 'mail run', zh: '邮件运行' },
];

const { ok, output } = checkDocs(process.argv.slice(2), join(import.meta.dirname, '..'), PAIRS, UNPAIRED, RENDERINGS);
(ok ? process.stdout : process.stderr).write(output);
process.exitCode = ok ? 0 : 1;
