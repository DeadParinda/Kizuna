export const state = {
  myId: '', myName: '', myAvatarUrl: '', myRoom: 'general',
  peers: new Map(), isSuperPeer: false,
  history: [], messages: [],
  replyToMsg: null, ctxTarget: null, editTarget: null, delTarget: null,
  isAtBot: true, unread: 0, sbOpen: window.innerWidth > 768,
  pickerOpen: false, plusOpen: false, pickerTab: 'emoji',
  gifTimer: null, typingTimer: null, typingShowTimer: null, saveHistoryTimer: null,
  presenceCh: null, signalCh: null,
  onlineUsers: new Map(),
  peerTab: 'online',
  _selPfpUrl: '', _profCatIdx: 0,
  reactTargetId: null,
  emojiPickerInst: null, reactPickerInst: null,
  _pastedFile: null,
  isTabFocused: true, unreadReplies: 0, hasUnreadMessages: false,
  myAvatarUpdatedAt: null,
  _pfpCanChange: true, _pfpDaysLeft: 0,
  hydrateProfilesTimer: null,
  toastT: null,
  gifSearchTimer: null,
  linkPreviewCache: new Map()
};
window.state = state; // expose state to window for inline HTML handlers
