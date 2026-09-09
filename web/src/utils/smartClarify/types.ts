export interface SmartRuleContext {
  rawText: string;
  targetId: string;
  isFirstMessage: boolean;
  timeSinceLastUserMessageSec: number;
}

export interface SmartRuleResult {
  modified: boolean;
  text: string;
  ruleName?: string;
  metadata?: Record<string, any>;
}

export interface SmartRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  timeoutSec: number;
  /**
   * Kiểm tra điều kiện áp dụng rule
   */
  shouldApply(context: SmartRuleContext): boolean;
  /**
   * Chuyển hóa/đóng gói nội dung trước khi gửi đi
   */
  transform(context: SmartRuleContext): SmartRuleResult;
}
