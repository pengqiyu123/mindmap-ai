/**
 * 活动会话共享状态
 * 浏览器和 IDE 通过这个模块共享"当前正在编辑哪张导图"
 */
let activeSessionId: string | null = null;

export function getActiveSessionId(): string | null {
  return activeSessionId;
}

export function setActiveSessionId(id: string | null): void {
  activeSessionId = id;
}
