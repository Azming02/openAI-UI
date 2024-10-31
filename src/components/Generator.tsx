import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { useThrottleFn } from 'solidjs-use';
import { generateSignature } from '@/utils/auth';
import IconClear from './icons/Clear';
import MessageItem from './MessageItem';
import SystemRoleSettings from './SystemRoleSettings';
import ErrorMessageItem from './ErrorMessageItem';
import type { ChatMessage, ErrorMessage } from '@/types';

export default () => {
  let inputRef: HTMLTextAreaElement;
  const [currentSystemRoleSettings, setCurrentSystemRoleSettings] = createSignal('');
  const [systemRoleEditing, setSystemRoleEditing] = createSignal(false);
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([]);
  const [currentError, setCurrentError] = createSignal<ErrorMessage>();
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [controller, setController] = createSignal<AbortController>(null);
  const [isStick, setStick] = createSignal(false);
  const [temperature, setTemperature] = createSignal(0.6);
  const temperatureSetting = (value: number) => { setTemperature(value); };
  const maxHistoryMessages = parseInt(import.meta.env.PUBLIC_MAX_HISTORY_MESSAGES || '9');

  
  createEffect(() => (isStick() && smoothToBottom()));
  

  // IndexedDB setup
  const dbName = 'chatApp';
  const storeName = 'settings';

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async function getFromDB(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = (event) => {
        resolve(event.target.result ? event.target.result.value : null);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async function saveToDB(key, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put({ id: key, value });

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  onMount(async () => {
    // 页面加载时将光标聚焦到输入框
    const keepFocus = (event: FocusEvent) => {
      event.preventDefault();
      inputRef.focus();
    };
    if (inputRef) {
      inputRef.focus();
      window.addEventListener('focusout', keepFocus);
    }
    let lastPostion = window.scrollY;
    
    window.addEventListener('scroll', () => {
      const nowPostion = window.scrollY;
      nowPostion < lastPostion && setStick(false);
      lastPostion = nowPostion;
    });

    try {
      const storedMessageList = await getFromDB('messageList');
      if (storedMessageList) {
        setMessageList(JSON.parse(storedMessageList));
      }

      const storedSystemRoleSettings = await getFromDB('systemRoleSettings');
      if (storedSystemRoleSettings) {
        setCurrentSystemRoleSettings(storedSystemRoleSettings);
      }

      const storedStickToBottom = await getFromDB('stickToBottom');
      if (storedStickToBottom === 'stick') {
        setStick(true);
      }
    } catch (err) {
      console.error(err);
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    onCleanup(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    });
  });

  const handleBeforeUnload = async () => {
    await saveToDB('messageList', JSON.stringify(messageList()));
    await saveToDB('systemRoleSettings', currentSystemRoleSettings());
    isStick() ? await saveToDB('stickToBottom', 'stick') : await saveToDB('stickToBottom', null);
  };

  const handleButtonClick = async () => {
    const inputValue = inputRef.value;
    if (!inputValue) return;

    inputRef.value = '';
    const newMessageList = [
      ...messageList(),
      {
        role: 'user',
        content: inputValue,
      },
    ];
    setMessageList(newMessageList);
    await saveToDB('messageList', JSON.stringify(newMessageList));
    requestWithLatestMessage();
    instantToBottom();
  };

  const smoothToBottom = useThrottleFn(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, 300, false, true);

  const instantToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  };

  const requestWithLatestMessage = async () => {
    setLoading(true);
    setCurrentAssistantMessage('');
    setCurrentError(null);
    const storagePassword = localStorage.getItem('pass');
    try {
      const controller = new AbortController();
      setController(controller);
      const requestMessageList = messageList().slice(-maxHistoryMessages);
      if (currentSystemRoleSettings()) {
        requestMessageList.unshift({
          role: 'system',
          content: currentSystemRoleSettings(),
        });
      }
      const timestamp = Date.now();
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');

      const response = await fetch('https://rag.addcn.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          messages: requestMessageList,
          time: timestamp,
          pass: storagePassword,
          sign: await generateSignature({
            t: timestamp,
            m: requestMessageList?.[requestMessageList.length - 1]?.content || '',
          }),
          sessionId: token,
          temperature: temperature(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.json();
        console.error(error.error);
        setCurrentError(error.error);
        throw new Error('Request failed');
      }
      const data = response.body;
      if (!data) throw new Error('No data');
      const reader = data.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          chunk.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data:')) {
              try {
                const jsonData = JSON.parse(trimmedLine.slice(5).trim());
                const content = jsonData.choices[0].delta.content;
                if (content) {
                  setCurrentAssistantMessage(currentAssistantMessage() + content);
                  isStick() && instantToBottom();
                }
              } catch (error) {
                console.error('Error parsing JSON:', error);
              }
            }
          });
        }
        done = readerDone;
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
      setController(null);
      return;
    }
    archiveCurrentMessage();
    isStick() && instantToBottom();
  };

  const archiveCurrentMessage = async () => {
    if (currentAssistantMessage()) {
      const newMessageList = [
        ...messageList(),
        {
          role: 'assistant',
          content: currentAssistantMessage(),
        },
      ];
      setMessageList(newMessageList);
      await saveToDB('messageList', JSON.stringify(newMessageList));
      setCurrentAssistantMessage('');
      setLoading(false);
      setController(null);
      if (!('ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0))
        inputRef.focus();
    }
  };

  const clear = async () => {
    inputRef.value = '';
    inputRef.style.height = 'auto';
    setMessageList([]);
    await saveToDB('messageList', JSON.stringify([]));
    setCurrentAssistantMessage('');
    setCurrentError(null);
  };

  const stopStreamFetch = () => {
    if (controller()) {
      controller().abort();
      archiveCurrentMessage();
    }
  };

  const retryLastFetch = () => {
    if (messageList().length > 0) {
      const lastMessage = messageList()[messageList().length - 1];
      if (lastMessage.role === 'assistant')
        setMessageList(messageList().slice(0, -1));
      requestWithLatestMessage();
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.isComposing || e.shiftKey) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      handleButtonClick();
    }
  };

  return (
    <div my-6>
      <SystemRoleSettings
        canEdit={() => messageList().length === 0}
        systemRoleEditing={systemRoleEditing}
        setSystemRoleEditing={setSystemRoleEditing}
        currentSystemRoleSettings={currentSystemRoleSettings}
        setCurrentSystemRoleSettings={setCurrentSystemRoleSettings}
        temperatureSetting={temperatureSetting}
      />
      <Index each={messageList()}>
        {(message, index) => (
          <MessageItem
            role={message().role}
            message={message().content}
            showRetry={() => (message().role === 'assistant' && index === messageList().length - 1)}
            onRetry={retryLastFetch}
          />
        )}
      </Index>
      {currentAssistantMessage() && (
        <MessageItem
          role="assistant"
          message={currentAssistantMessage}
        />
      )}
      {currentError() && <ErrorMessageItem data={currentError()} onRetry={retryLastFetch} />}
      <Show
        when={!loading()}
        fallback={() => (
          <div class="gen-cb-wrapper">
            <span>正在思考...</span>
            <div class="gen-cb-stop" onClick={stopStreamFetch}>Stop</div>
          </div>
        )}
      >
        <div class="gen-text-wrapper" class:op-50={systemRoleEditing()}>
          <textarea
            ref={inputRef!}
            disabled={systemRoleEditing()}
            onKeyDown={handleKeydown}
            placeholder="输入的内容..."
            autocomplete="off"
            autofocus
            onInput={() => {
              inputRef.style.height = 'auto';
              inputRef.style.height = `${inputRef.scrollHeight}px`;
            }}
            rows="1"
            class="gen-textarea"
          />
          <button onClick={handleButtonClick} disabled={systemRoleEditing()} gen-slate-btn class='send-button'>
            发送
          </button>
          <button title="清空" onClick={clear} disabled={systemRoleEditing()} gen-slate-btn>
            <IconClear />
          </button>
        </div>
      </Show>
      <div class="fixed bottom-5 left-5 rounded-md hover:bg-slate/10 w-fit h-fit transition-colors active:scale-90" class:stick-btn-on={isStick()}>
      {/* 左下角按钮去除 */}
        {/*  <div> */}
           {/* <button class="p-2.5 text-base" title="stick to bottom" type="button" onClick={() => setStick(!isStick())}> */}
             {/* <div i-ph-arrow-line-down-bold /> */}
           {/* </button> */}
        {/*  </div> */}
      </div>
    </div>
  );
};
