import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { useThrottleFn } from 'solidjs-use';
import { generateSignature } from '@/utils/auth';
import IconClear from './icons/Clear';
import MessageItem from './MessageItem';
import SystemRoleSettings from './SystemRoleSettings';
import ErrorMessageItem from './ErrorMessageItem';
import type { ChatMessage, ErrorMessage } from '@/types';

export default () => {
  // 定义一个inputRef变量， 用于引用文本区域元素
  let inputRef: HTMLTextAreaElement;
  // 创建currentSystemRoleSettings 信号和其更新函数。
  const [currentSystemRoleSettings, setCurrentSystemRoleSettings] = createSignal('');
  // 信号，指示系统角色是否正在编辑
  const [systemRoleEditing, setSystemRoleEditing] = createSignal(false);
  // 用于存储聊天消息列表
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([]);
  // 存储当前错误信息
  const [currentError, setCurrentError] = createSignal<ErrorMessage>();
  // 存储当前助手消息
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal('');
  // 指示是否正在加载
  const [loading, setLoading] = createSignal(false);
  // 控制请求的终止
  const [controller, setController] = createSignal<AbortController>(null);
  // 指示是否固定滚动到底部
  const [isStick, setStick] = createSignal(false);
  // 设置对话生成的温度参数。
  const [temperature, setTemperature] = createSignal(0.6);
  // 定义 temperatureSetting 函数，用于更新温度设置。
  const temperatureSetting = (value: number) => { setTemperature(value); };
  // 从环境变量中获取最大历史消息数，默认为 9。
  const maxHistoryMessages = parseInt(import.meta.env.PUBLIC_MAX_HISTORY_MESSAGES || '9');

  // 当isStick为true时，平滑滚动到底部
  createEffect(() => (isStick() && smoothToBottom()));
  

  
  const dbName = 'chatApp';  // 数据库名称
  const storeName = 'settings';  // 对象存储名称

  // 用于打开 IndexedDB数据库
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);   // 打开IndexedDB数据库，版本为1

      // 处理数据库升级事件
      request.onupgradeneeded = (event) => {
        // 获取数据库实例
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(storeName)) {
          // 如果不存在，创建对象存储，使用id作为键路径
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  // 异步函数，用于从数据库获取数据
  async function getFromDB(key) {
    // 等待数据库打开
    const db = await openDatabase() as IDBDatabase;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');  // 只读事务
      const store = transaction.objectStore(storeName);  // 获取对象存储
      const request = store.get(key);  // 获取指定键额的数据

      // 解析，返回数据或null
      request.onsuccess = (event) => {
        const target = event.target as IDBRequest;
        resolve(target.result ? target.result.value : null);
      };

      request.onerror = (event) => {
        const target = event.target as IDBRequest;
        reject(target.error);
      };
    });
  }

  // 异步函数，用于保存数据到数据库, 提示 Promise 不会返回任何值
  async function saveToDB(key, value): Promise<void> {
    const db = await openDatabase() as IDBDatabase;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');  // 读写事务
      const store = transaction.objectStore(storeName);   // 获取对象存储
      const request = store.put({ id: key, value });  // 保存数据到对象存储

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  // 使用 onMount 钩子，定义组件挂载时的逻辑
  onMount(async () => {
    // 页面加载时将光标聚焦到输入框
    const keepFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement; // 将事件目标转换为 HTMLElement
      // 如果点击的元素是特殊按钮，则不聚焦输入框
    if (event.target !== inputRef && !target.classList.contains('allow-focus')) {
      // event.preventDefault();  //阻止按键的默认行为
      inputRef.focus();
    }
  };

    if (inputRef) { // 判断输入框引用是否存在
      setTimeout(() => {
        inputRef.focus();
      }, 0); // 确保立即获得焦点
      window.addEventListener('focusout', keepFocus);  // focusout 事件监听，保持输入框焦点
    }

    // 记录滚动位置
    let lastPostion = window.scrollY;
    
    // 添加滚动事件监听器
    window.addEventListener('scroll', () => {
      const nowPostion = window.scrollY;  // 获取当前滚动位置
      nowPostion < lastPostion && setStick(false);  // 如果当前滚动位置小于上次位置，取消固定到底部
      lastPostion = nowPostion;  // 更新
    });

    try {  // 尝试从数据库加载数据

      const storedMessageList = await getFromDB('messageList');  // 从数据库中获取存储的消息列表
      if (storedMessageList) { 
        setMessageList(JSON.parse(storedMessageList));
      }

      const storedSystemRoleSettings = await getFromDB('systemRoleSettings');  // 系统角色
      if (storedSystemRoleSettings) {
        setCurrentSystemRoleSettings(storedSystemRoleSettings);
      }

      const storedStickToBottom = await getFromDB('stickToBottom');   // 滑轮位置
      if (storedStickToBottom === 'stick') {
        setStick(true);
      }
    } catch (err) {
      console.error(err);
    }

    window.addEventListener('beforeunload', handleBeforeUnload);  // 添加事件监听，页面关闭前保存状态
    onCleanup(() => {  // 移除事件监听
      window.removeEventListener('beforeunload', handleBeforeUnload);
    });
  });

  // 处理页面卸载前的保持逻辑
  const handleBeforeUnload = async () => {
    await saveToDB('messageList', JSON.stringify(messageList()));
    await saveToDB('systemRoleSettings', currentSystemRoleSettings());
    isStick() ? await saveToDB('stickToBottom', 'stick') : await saveToDB('stickToBottom', null);
  };

  const handleButtonClick = async () => {
    const inputValue = inputRef.value;
    if (!inputValue) return;

    inputRef.value = '';
    // 清空输入框
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

  // 创建节流的平滑滚动到底部函数
  const smoothToBottom = useThrottleFn(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, 300, false, true);

  // 立即滚动到底部
  const instantToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  };

  // 处理与服务器的交互
  const requestWithLatestMessage = async () => {
    setLoading(true);
    setCurrentAssistantMessage('');
    setCurrentError(null);
    const storagePassword = localStorage.getItem('pass');  // 获取存储的密码
    try {
      const controller = new AbortController();
      setController(controller);
      // 获取消息列表的最后几条消息，限制数量
      const requestMessageList = messageList().slice(-maxHistoryMessages);
      if (currentSystemRoleSettings()) {  // 如果有系统角色设置，添加到消息列表的开头
        requestMessageList.unshift({
          role: 'system',
          content: currentSystemRoleSettings(),
        });
      }
      const timestamp = Date.now();
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');

      // const response = await fetch('https://rag.addcn.com/v1/chat/completions', {
      const response = await fetch('http://192.168.22.33:5000/v1/chat/completions', {
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
          temperature: temperature(),  // 温度
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

      // 创建读取器和解码器
      const reader = data.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;

      while (!done) {  // 循环读取响应数据，解码并处理每一行
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
    isStick() && instantToBottom();  // 滑轮固定到底部
  };

  // 保存助手信息
  const archiveCurrentMessage = async () => {
    if (currentAssistantMessage()) {  // 如果有助手信息，将其添加到列表，然后重置状态
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

  // 清空输入框、消息列表和错误信息
  const clear = async () => {
    inputRef.value = '';
    inputRef.style.height = 'auto';
    setMessageList([]);
    await saveToDB('messageList', JSON.stringify([]));
    setCurrentAssistantMessage('');
    setCurrentError(null);
  };

  // 终止当前请求并保存消息
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
        setMessageList(messageList().slice(0, -1));  // 如果最后一条信息是助手的消息，从列表删除
      requestWithLatestMessage();  // 重新发送请求处理最新消息
    }
  };

  // 输入输入框的键盘按下事件，回车键
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
