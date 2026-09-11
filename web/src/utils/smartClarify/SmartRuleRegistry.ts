import { SmartRule, SmartRuleContext, SmartRuleResult } from './types';
import { InactivityClarifyRule } from './rules/InactivityClarifyRule';

const STORAGE_KEY_SMART_MODE = 'af-smart-mode-master';
const STORAGE_KEY_INACTIVITY_SEC = 'af-smart-inactivity-sec';

export class SmartRuleRegistry {
  private static instance: SmartRuleRegistry;
  private rules: Map<string, SmartRule> = new Map();
  private masterEnabled: boolean = false;
  private lastUserSendTimestamp: number = 0;

  private constructor() {
    // Khởi tạo cài đặt từ localStorage (mặc định tắt false nếu chưa lưu)
    try {
      const storedMaster = localStorage.getItem(STORAGE_KEY_SMART_MODE);
      if (storedMaster !== null) {
        this.masterEnabled = storedMaster === 'true';
      } else {
        this.masterEnabled = false;
      }
    } catch {
      this.masterEnabled = false;
    }

    // Đăng ký Rule mặc định: InactivityClarifyRule (30s timeout)
    const clarifyRule = new InactivityClarifyRule(this.masterEnabled, 30);
    this.registerRule(clarifyRule);
  }

  public static getInstance(): SmartRuleRegistry {
    if (!SmartRuleRegistry.instance) {
      SmartRuleRegistry.instance = new SmartRuleRegistry();
    }
    return SmartRuleRegistry.instance;
  }

  public registerRule(rule: SmartRule) {
    this.rules.set(rule.id, rule);
  }

  public getRule(id: string): SmartRule | undefined {
    return this.rules.get(id);
  }

  public getAllRules(): SmartRule[] {
    return Array.from(this.rules.values());
  }

  public isMasterEnabled(): boolean {
    return this.masterEnabled;
  }

  public setMasterEnabled(enabled: boolean) {
    this.masterEnabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY_SMART_MODE, String(enabled));
    } catch {}

    // Cập nhật trạng thái cho rule inactivity clarify mặc định
    const defaultRule = this.rules.get('inactivity-clarify');
    if (defaultRule) {
      defaultRule.enabled = enabled;
    }
  }

  public setTimeoutSec(sec: number) {
    const defaultRule = this.rules.get('inactivity-clarify');
    if (defaultRule) {
      defaultRule.timeoutSec = Math.max(5, sec);
      try {
        localStorage.setItem(STORAGE_KEY_INACTIVITY_SEC, String(defaultRule.timeoutSec));
      } catch {}
    }
  }

  public getTimeoutSec(): number {
    const defaultRule = this.rules.get('inactivity-clarify');
    return defaultRule?.timeoutSec ?? 30;
  }

  public setPromptTemplate(template: string) {
    const defaultRule = this.rules.get('inactivity-clarify') as any;
    if (defaultRule && typeof defaultRule.setPromptTemplate === 'function') {
      defaultRule.setPromptTemplate(template);
      try {
        localStorage.setItem('agentforge_smart_clarify_template', template);
      } catch {}
    }
  }

  public setTargetScope(scope: 'orchestrator' | 'all') {
    const defaultRule = this.rules.get('inactivity-clarify') as any;
    if (defaultRule && typeof defaultRule.setTargetScope === 'function') {
      defaultRule.setTargetScope(scope);
      try {
        localStorage.setItem('agentforge_smart_clarify_scope', scope);
      } catch {}
    }
  }

  public getTargetScope(): 'orchestrator' | 'all' {
    const defaultRule = this.rules.get('inactivity-clarify') as any;
    return defaultRule?.targetScope || 'orchestrator';
  }

  public getPromptTemplate(): string {
    const defaultRule = this.rules.get('inactivity-clarify') as any;
    return defaultRule?.promptTemplate || 'Người dùng nói rằng "{content}", bạn hãy xác minh theo sự hiểu của bạn và hỏi lại người dùng xem có đúng ý bạn không một lần nữa.';
  }

  public recordMessageActivity() {
    this.lastUserSendTimestamp = Date.now();
  }

  /**
   * Xử lý tin nhắn xuất phát từ User qua toàn bộ pipeline các smart rules đã đăng ký
   */
  public processMessage(rawText: string, targetId: string = 'orchestrator', targetRole?: string, targetType?: string): SmartRuleResult {
    const now = Date.now();
    const isFirstMessage = this.lastUserSendTimestamp === 0;
    const timeSinceLastUserMessageSec = isFirstMessage ? 999999 : Math.max(0, (now - this.lastUserSendTimestamp) / 1000);

    const context: SmartRuleContext = {
      rawText,
      targetId,
      isFirstMessage,
      timeSinceLastUserMessageSec,
      targetRole,
      targetType
    };

    // Đánh dấu mốc thời gian của tin nhắn vừa gửi
    this.lastUserSendTimestamp = now;

    if (!this.masterEnabled) {
      return { modified: false, text: rawText };
    }

    // Duyệt qua pipeline các rules
    for (const rule of this.rules.values()) {
      if (rule.enabled && rule.shouldApply(context)) {
        return rule.transform(context);
      }
    }

    return { modified: false, text: rawText };
  }

  /**
   * Reset bộ đếm thời gian (ví dụ khi chuyển agent hoặc khởi tạo mới)
   */
  public resetTimer() {
    this.lastUserSendTimestamp = 0;
  }
}

export const smartRuleRegistry = SmartRuleRegistry.getInstance();
