import { existsSync, appendFileSync, readFileSync, writeFileSync, statSync, renameSync, copyFileSync } from 'fs';
import { join } from 'path';
import { CHAT_JSONL_FILE, DATA_DIR } from './constants.js';

export interface ChatMessage {
  id?: string;
  from?: string;
  from_id?: string;
  to?: string;
  to_id?: string;
  teamId?: string;
  content?: any;
  timestamp?: number;
  [key: string]: any;
}

export class ChatWAL {
  private filePath: string;
  private maxSizeBytes: number;
  private hydrated = false;
  private cachedMessages?: ChatMessage[];

  constructor(filePath: string = CHAT_JSONL_FILE, maxSizeBytes: number = 100 * 1024 * 1024) {
    this.filePath = filePath;
    this.maxSizeBytes = maxSizeBytes;
  }

  public isHydrated(): boolean {
    return this.hydrated;
  }

  /**
   * Hydrate WAL 1 lần duy nhất trong toàn bộ tiến trình.
   * Cache kết quả để tránh đọc/đăng ký nhiều lần khi có nhiều instance sử dụng singleton chatWAL.
   * Trả về mảng messages; gọi lần thứ hai sẽ trả về cache (không log).
   */
  public hydrateOnce(): ChatMessage[] {
    if (this.hydrated) {
      return this.cachedMessages ?? [];
    }
    this.hydrated = true;
    if (!existsSync(this.filePath)) {
      this.cachedMessages = [];
      return [];
    }
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const lines = content.split('\n');
      const messages: ChatMessage[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') {
            messages.push(parsed);
          }
        } catch {
          // skip corrupted line
        }
      }
      this.cachedMessages = messages;
      if (messages.length > 0) {
        console.log(`[ChatWAL] Hydrated ${messages.length} messages from ${messages.length} WAL entries`);
      }
      return messages;
    } catch (e: any) {
      console.error(`[ChatWAL] Error hydrating WAL file ${this.filePath}:`, e?.message || e);
      this.cachedMessages = [];
      return [];
    }
  }

  /**
   * Được gọi bởi rewriteAll để làm mới cache sau khi ghi đè vào WAL.
   */
  public clearCache(): void {
    this.hydrated = false;
    this.cachedMessages = undefined;
  }

  /**
   * Append-only tin nhắn mới vào chat.jsonl WAL với checksum/dòng hoàn chỉnh.
   */
  public appendMessage(msg: ChatMessage): void {
    try {
      this.checkRotate();
      const line = JSON.stringify(msg) + '\n';
      appendFileSync(this.filePath, line, 'utf-8');
    } catch (e: any) {
      console.error(`[ChatWAL] Error appending message to ${this.filePath}:`, e?.message || e);
    }
  }

  /**
   * Đọc tất cả tin nhắn từ WAL. Bỏ qua các dòng hỏng/lỗi format JSON.
   */
  public readAll(): ChatMessage[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const lines = content.split('\n');
      const messages: ChatMessage[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') {
            messages.push(parsed);
          }
        } catch (e) {
          console.warn(`[ChatWAL] Skipped corrupted JSONL line: ${trimmed.slice(0, 50)}...`);
        }
      }
      return messages;
    } catch (e: any) {
      console.error(`[ChatWAL] Error reading WAL file ${this.filePath}:`, e?.message || e);
      return [];
    }
  }

  /**
   * Ghi đè lại toàn bộ WAL (dùng khi rotate, delete/clear conversation, hoặc update message cũ).
   * Trước khi ghi đè, tự động backup file WAL hiện tại sang <file>.bak_<timestamp> để phòng mất dữ liệu.
   * param backup: khi false → bỏ qua copyFileSync backup (hot-path update để tránh disk amplification).
   */
  public rewriteAll(messages: ChatMessage[], backup: boolean = true): void {
    try {
      if (backup && existsSync(this.filePath)) {
        const bak = `${this.filePath}.bak_${Date.now()}`;
        copyFileSync(this.filePath, bak);
      }
      const lines = messages.map(m => JSON.stringify(m)).join('\n') + (messages.length ? '\n' : '');
      writeFileSync(this.filePath, lines, 'utf-8');
    } catch (e: any) {
      console.error(`[ChatWAL] Error rewriting WAL file ${this.filePath}:`, e?.message || e);
    }
  }

  /**
   * Kiểm tra dung lượng file WAL, nếu vượt mốc maxSizeBytes (mặc định 100MB), tiến hành rotate file backup.
   */
  public checkRotate(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const stats = statSync(this.filePath);
      if (stats.size >= this.maxSizeBytes) {
        this.rotateBackup();
      }
    } catch (e: any) {
      console.warn(`[ChatWAL] Error checking WAL size:`, e?.message || e);
    }
  }

  /**
   * Xoay file backup khi WAL đầy (chat.jsonl -> chat_backup_<timestamp>.jsonl).
   */
  public rotateBackup(): string | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(DATA_DIR, `chat_backup_${timestamp}.jsonl`);
      renameSync(this.filePath, backupPath);
      console.log(`[ChatWAL] Rotated WAL file: ${this.filePath} -> ${backupPath}`);
      return backupPath;
    } catch (e: any) {
      console.error(`[ChatWAL] Error rotating WAL file:`, e?.message || e);
      return null;
    }
  }
}

export const chatWAL = new ChatWAL();
