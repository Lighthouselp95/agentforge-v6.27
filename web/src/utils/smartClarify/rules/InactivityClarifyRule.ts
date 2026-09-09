import { SmartRule, SmartRuleContext, SmartRuleResult } from './types';

/**
 * InactivityClarifyRule:
 * Khi người dùng không nhập tin nhắn mới trong khoảng thời gian timeout (mặc định 30s):
 * Tự động đóng gói nội dung theo mẫu:
 * 'người dùng nói rằng "<nội dung>" bạn hãy xác minh theo sự hiểu của bạn và hỏi lại người dùng xem có đúng ý bạn không một lần nữa'
 */
export class InactivityClarifyRule implements SmartRule {
  public id = 'inactivity-clarify';
  public name = 'Smart Clarify Inactivity (30s)';
  public description = 'Tự động yêu cầu agent xác minh và hỏi lại nếu người dùng không chat trong hơn 30s';
  public enabled = true;
  public timeoutSec = 30;

  constructor(enabled: boolean = true, timeoutSec: number = 30) {
    this.enabled = enabled;
    this.timeoutSec = timeoutSec;
  }

  public shouldApply(context: SmartRuleContext): boolean {
    if (!this.enabled) return false;
    // 1. Tin nhắn đầu tiên khi vừa mở app (isFirstMessage = true): Chèn câu xác minh
    // 2. Hoặc sau đó nếu trong hơn 30s không phát sinh câu nói nào (timeSinceLastUserMessageSec >= 30s): Reset và chèn câu xác minh
    return context.isFirstMessage || context.timeSinceLastUserMessageSec >= this.timeoutSec;
  }

  public transform(context: SmartRuleContext): SmartRuleResult {
    const trimmed = (context.rawText || '').trim();
    if (!trimmed) {
      return { modified: false, text: context.rawText };
    }

    const transformedText = `người dùng nói rằng "${trimmed}" bạn hãy xác minh theo sự hiểu của bạn và hỏi lại người dùng xem có đúng ý bạn không một lần nữa`;

    return {
      modified: true,
      text: transformedText,
      ruleName: this.id,
      metadata: {
        originalText: trimmed,
        inactivitySec: context.timeSinceLastUserMessageSec
      }
    };
  }
}
