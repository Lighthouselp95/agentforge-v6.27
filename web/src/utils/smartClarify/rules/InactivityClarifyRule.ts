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
  public promptTemplate = 'Người dùng nói rằng "{content}", bạn hãy xác minh theo sự hiểu của bạn và hỏi lại người dùng xem có đúng ý bạn không một lần nữa.';
  public targetScope: 'orchestrator' | 'all' = 'orchestrator';

  constructor(enabled: boolean = true, timeoutSec: number = 30, promptTemplate?: string, targetScope: 'orchestrator' | 'all' = 'orchestrator') {
    this.enabled = enabled;
    this.timeoutSec = timeoutSec;
    this.targetScope = targetScope;
    if (promptTemplate && promptTemplate.trim()) {
      this.promptTemplate = promptTemplate;
    }
  }

  public setPromptTemplate(template: string): void {
    if (template && template.trim()) {
      this.promptTemplate = template;
    }
  }

  public setTargetScope(scope: 'orchestrator' | 'all'): void {
    this.targetScope = scope;
  }

  public shouldApply(context: SmartRuleContext): boolean {
    if (!this.enabled) return false;
    
    // Kiểm tra phạm vi áp dụng:
    // Nếu cài đặt là 'orchestrator' thì chỉ áp dụng khi gửi tin nhắn cho Orchestrator
    if (this.targetScope === 'orchestrator') {
      const isOrch = context.targetId === 'orchestrator' || context.targetRole === 'orchestrator' || context.targetType === 'orchestrator';
      if (!isOrch) return false;
    }

    // 1. Tin nhắn đầu tiên khi vừa mở app (isFirstMessage = true): Chèn câu xác minh
    // 2. Hoặc sau đó nếu trong hơn 30s không phát sinh câu nói nào (timeSinceLastUserMessageSec >= 30s): Reset và chèn câu xác minh
    return context.isFirstMessage || context.timeSinceLastUserMessageSec >= this.timeoutSec;
  }

  public transform(context: SmartRuleContext): SmartRuleResult {
    const trimmed = (context.rawText || '').trim();
    if (!trimmed) {
      return { modified: false, text: context.rawText };
    }

    const transformedText = this.promptTemplate.includes('{content}')
      ? this.promptTemplate.replace('{content}', trimmed)
      : (this.promptTemplate.includes('{xx}') ? this.promptTemplate.replace('{xx}', trimmed) : `${this.promptTemplate}: "${trimmed}"`);

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
