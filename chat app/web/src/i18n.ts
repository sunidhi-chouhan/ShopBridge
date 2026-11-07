import type { Language } from "../../shared/types";

/**
 * Interface strings for the conversation and support path, in the reader's language.
 * Message content itself is translated live by Nexconn; these are only UI labels.
 * Languages without an entry fall back to English.
 */
const en = {
  message: "Message",
  messageHint: "Enter to send · Shift+Enter for a new line",
  send: "Send",
  sending: "Sending",
  attachPhoto: "Add photo",
  photoSending: "Sending photo",
  photo: "Photo",
  readIn: "Read messages in",
  autoTranslate: "Translate automatically",
  translated: "Translated",
  translating: "Translating…",
  translationOff: "Translation unavailable",
  showOriginal: "Show original",
  hideOriginal: "Hide original",
  translateTo: "Translate to",
  retryTranslation: "Retry translation",
  willRead: "{name} will read:",
  loadOlder: "Load earlier messages",
  noMessages: "No messages yet. Say hello when you are ready.",
  you: "You",
  system: "ShopBridge",
  getHelp: "Get help with this order",
  helpLede: "A support agent joins this same conversation and can read everything so far.",
  helpLabel: "What went wrong?",
  helpHint: "Optional. You can write in your own language.",
  requestHelp: "Ask support to join",
  cancel: "Cancel",
  supportWaiting: "Waiting for a support agent",
  supportWith: "{name} from support is helping",
  supportProposed: "Support proposed a resolution",
  supportResolved: "Resolved",
  proposalTitle: "Proposed resolution",
  accept: "Yes, this solves it",
  decline: "No, it does not",
  reconnecting: "Reconnecting to chat…",
  offline: "Chat is offline. New messages will not arrive until it reconnects.",
  elsewhere: "This account opened chat in another window, so chat is paused here.",
  reconnect: "Reconnect",
  useHere: "Use chat here",
  newMessage: "New message",
  open: "Open",
};

type Strings = typeof en;

const hi: Strings = {
  message: "संदेश",
  messageHint: "भेजने के लिए Enter · नई पंक्ति के लिए Shift+Enter",
  send: "भेजें",
  sending: "भेज रहे हैं",
  attachPhoto: "फ़ोटो जोड़ें",
  photoSending: "फ़ोटो भेज रहे हैं",
  photo: "फ़ोटो",
  readIn: "संदेश इस भाषा में पढ़ें",
  autoTranslate: "अपने आप अनुवाद करें",
  translated: "अनुवादित",
  translating: "अनुवाद हो रहा है…",
  translationOff: "अनुवाद उपलब्ध नहीं",
  showOriginal: "मूल संदेश दिखाएँ",
  hideOriginal: "मूल संदेश छिपाएँ",
  translateTo: "अनुवाद करें:",
  retryTranslation: "फिर से अनुवाद करें",
  willRead: "{name} यह पढ़ेंगी/पढ़ेंगे:",
  loadOlder: "पुराने संदेश देखें",
  noMessages: "अभी कोई संदेश नहीं है। बातचीत शुरू करें।",
  you: "आप",
  system: "ShopBridge",
  getHelp: "इस ऑर्डर के लिए मदद लें",
  helpLede: "सहायता एजेंट इसी बातचीत में जुड़ेंगे और अब तक की पूरी बातचीत पढ़ सकेंगे।",
  helpLabel: "क्या समस्या है?",
  helpHint: "वैकल्पिक। आप अपनी भाषा में लिख सकते हैं।",
  requestHelp: "सहायता को बुलाएँ",
  cancel: "रद्द करें",
  supportWaiting: "सहायता एजेंट का इंतज़ार",
  supportWith: "सहायता से {name} मदद कर रहे हैं",
  supportProposed: "सहायता ने समाधान सुझाया है",
  supportResolved: "समाधान हो गया",
  proposalTitle: "सुझाया गया समाधान",
  accept: "हाँ, इससे हल हो गया",
  decline: "नहीं, हल नहीं हुआ",
  reconnecting: "चैट फिर से जुड़ रही है…",
  offline: "चैट ऑफ़लाइन है। जुड़ने तक नए संदेश नहीं आएँगे।",
  elsewhere: "यह खाता किसी दूसरी विंडो में खुला है, इसलिए यहाँ चैट रुकी है।",
  reconnect: "फिर से जोड़ें",
  useHere: "यहीं चैट करें",
  newMessage: "नया संदेश",
  open: "खोलें",
};

const tables: Partial<Record<Language, Strings>> = { en, hi };

export type StringKey = keyof Strings;

export function t(language: Language, key: StringKey, vars?: Record<string, string>): string {
  let text = (tables[language] ?? en)[key] ?? en[key];
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value);
  return text;
}

export const RESOLUTION_COPY: Record<Language, Record<"replacement" | "refund" | "return" | "info", string>> = {
  en: { replacement: "Replacement", refund: "Refund", return: "Return and refund", info: "Information shared" },
  hi: { replacement: "बदलकर नया सामान", refund: "पैसे वापस", return: "वापसी और पैसे वापस", info: "जानकारी दी गई" },
  ar: { replacement: "Replacement", refund: "Refund", return: "Return and refund", info: "Information shared" },
  zh: { replacement: "Replacement", refund: "Refund", return: "Return and refund", info: "Information shared" },
  es: { replacement: "Replacement", refund: "Refund", return: "Return and refund", info: "Information shared" },
  fr: { replacement: "Replacement", refund: "Refund", return: "Return and refund", info: "Information shared" },
};
