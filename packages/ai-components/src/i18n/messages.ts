export interface Messages {
  common: {
    loading: string;
    error: string;
    retry: string;
    cancel: string;
    confirm: string;
    save: string;
    delete: string;
    send: string;
  };
  chat: {
    placeholder: string;
    thinking: string;
    errorMessage: string;
    newConversation: string;
  };
  project: {
    create: string;
    settings: string;
    members: string;
    trash: string;
    restore: string;
    permanentDelete: string;
  };
}

export const en: Messages = {
  common: {
    loading: 'Loading...',
    error: 'An error occurred',
    retry: 'Retry',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    delete: 'Delete',
    send: 'Send',
  },
  chat: {
    placeholder: 'Type a message...',
    thinking: 'Thinking...',
    errorMessage: 'Something went wrong. Please try again.',
    newConversation: 'New Conversation',
  },
  project: {
    create: 'Create Project',
    settings: 'Settings',
    members: 'Members',
    trash: 'Trash',
    restore: 'Restore',
    permanentDelete: 'Delete Permanently',
  },
};

export const zh: Messages = {
  common: {
    loading: '加载中...',
    error: '发生错误',
    retry: '重试',
    cancel: '取消',
    confirm: '确认',
    save: '保存',
    delete: '删除',
    send: '发送',
  },
  chat: {
    placeholder: '输入消息...',
    thinking: '思考中...',
    errorMessage: '出错了，请重试。',
    newConversation: '新对话',
  },
  project: {
    create: '创建项目',
    settings: '设置',
    members: '成员',
    trash: '回收站',
    restore: '恢复',
    permanentDelete: '永久删除',
  },
};

export type Locale = 'en' | 'zh';

export function getMessages(locale: Locale): Messages {
  return locale === 'zh' ? zh : en;
}
