const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Ваш токен бота
const BOT_TOKEN = '8127780450:AAHaerKpn5LKutGijkLsRIxdFloqG4hz9Eg';
const bot = new Telegraf(BOT_TOKEN);

// URL вашего мини-апп
const MINI_APP_URL = 'https://yavibetodo-telegram-539l.bolt.host';

// Временное хранилище данных (в продакшене используйте базу данных)
const userData = new Map();

// Middleware
app.use(cors({
  origin: ['https://dimidolid.github.io', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Bot server is running!', users: userData.size });
});

// Функция для проверки Telegram Web App данных
function verifyTelegramWebAppData(telegramInitData) {
  try {
    const params = new URLSearchParams(telegramInitData);
    const hash = params.get('hash');
    params.delete('hash');
    
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    return hash === calculatedHash;
  } catch (error) {
    console.error('Ошибка верификации:', error);
    return false;
  }
}

// Функция получения пользователя из Telegram данных
function getUserFromTelegramData(telegramInitData) {
  try {
    const params = new URLSearchParams(telegramInitData);
    const userJson = params.get('user');
    if (!userJson) return null;
    
    return JSON.parse(decodeURIComponent(userJson));
  } catch (error) {
    console.error('Ошибка парсинга пользователя:', error);
    return null;
  }
}

// Webhook endpoint для Telegram
app.use(bot.webhookCallback('/webhook'));

// Команды бота
bot.start((ctx) => {
  const userId = ctx.from.id;
  const user = ctx.from;
  
  // Сохраняем информацию о пользователе
  if (!userData.has(userId)) {
    userData.set(userId, {
      id: userId,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      todos: [],
      created_at: new Date()
    });
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📝 Открыть Todo App',
            web_app: { url: MINI_APP_URL }
          }
        ]
      ]
    }
  };

  ctx.reply(
    `Добро пожаловать, ${user.first_name}! 🎉\n\nВаш персональный Todo менеджер готов к работе.\nНажмите кнопку ниже, чтобы открыть приложение:`,
    keyboard
  );
});

bot.help((ctx) => {
  ctx.reply(
    'Доступные команды:\n' +
    '/start - Запустить приложение\n' +
    '/help - Показать эту справку\n' +
    '/app - Открыть Todo приложение\n' +
    '/stats - Показать статистику задач'
  );
});

bot.command('app', (ctx) => {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📝 Открыть Todo App',
            web_app: { url: MINI_APP_URL }
          }
        ]
      ]
    }
  };

  ctx.reply('Откройте ваше Todo приложение:', keyboard);
});

bot.command('stats', (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (!user || !user.todos) {
    ctx.reply('У вас пока нет задач. Откройте приложение, чтобы создать первую задачу!');
    return;
  }
  
  const total = user.todos.length;
  const completed = user.todos.filter(todo => todo.completed).length;
  const pending = total - completed;
  
  ctx.reply(
    `📊 Ваша статистика:\n\n` +
    `📝 Всего задач: ${total}\n` +
    `✅ Выполнено: ${completed}\n` +
    `⏳ В процессе: ${pending}\n` +
    `🎯 Прогресс: ${total > 0 ? Math.round((completed / total) * 100) : 0}%`
  );
});

// API endpoints для мини-апп

// Получение пользователя и его задач
app.post('/api/user', (req, res) => {
  const { initData } = req.body;
  
  if (!initData) {
    // Режим разработки - создаем тестового пользователя
    const testUser = {
      id: 12345,
      first_name: 'Test',
      last_name: 'User',
      username: 'testuser'
    };
    
    if (!userData.has(testUser.id)) {
      userData.set(testUser.id, {
        ...testUser,
        todos: [],
        created_at: new Date()
      });
    }

    const user = userData.get(testUser.id);
    return res.json({
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username
      },
      todos: user.todos || []
    });
  }

  // В разработке можно пропустить проверку
  const isValid = process.env.NODE_ENV === 'development' || verifyTelegramWebAppData(initData);
  
  if (!isValid) {
    return res.status(401).json({ error: 'Неверные данные Telegram' });
  }

  const user = getUserFromTelegramData(initData);
  if (!user) {
    return res.status(400).json({ error: 'Не удалось получить данные пользователя' });
  }

  // Создаем или получаем пользователя
  if (!userData.has(user.id)) {
    userData.set(user.id, {
      ...user,
      todos: [],
      created_at: new Date()
    });
  }

  const userData_user = userData.get(user.id);
  res.json({
    user: {
      id: userData_user.id,
      first_name: userData_user.first_name,
      last_name: userData_user.last_name,
      username: userData_user.username
    },
    todos: userData_user.todos || []
  });
});

// Получение задач пользователя
app.get('/api/todos/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = userData.get(userId);
  
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  res.json(user.todos || []);
});

// Создание новой задачи
app.post('/api/todos', (req, res) => {
  const { userId, text, initData } = req.body;
  
  if (!userId || !text) {
    return res.status(400).json({ error: 'UserId и text обязательны' });
  }

  const user = userData.get(parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const newTodo = {
    id: Date.now(),
    text: text.trim(),
    completed: false,
    createdAt: new Date().toISOString()
  };

  if (!user.todos) {
    user.todos = [];
  }
  
  user.todos.push(newTodo);
  userData.set(parseInt(userId), user);
  
  res.json(newTodo);
});

// Обновление задачи
app.put('/api/todos/:todoId', (req, res) => {
  const { todoId } = req.params;
  const { userId, completed, text } = req.body;
  
  const user = userData.get(parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const todoIndex = user.todos.findIndex(todo => todo.id === parseInt(todoId));
  if (todoIndex === -1) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }

  if (completed !== undefined) {
    user.todos[todoIndex].completed = completed;
  }
  
  if (text !== undefined) {
    user.todos[todoIndex].text = text.trim();
  }
  
  user.todos[todoIndex].updatedAt = new Date().toISOString();
  userData.set(parseInt(userId), user);
  
  res.json(user.todos[todoIndex]);
});

// Удаление задачи
app.delete('/api/todos/:todoId', (req, res) => {
  const { todoId } = req.params;
  const { userId } = req.body;
  
  const user = userData.get(parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const todoIndex = user.todos.findIndex(todo => todo.id === parseInt(todoId));
  if (todoIndex === -1) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }

  user.todos.splice(todoIndex, 1);
  userData.set(parseInt(userId), user);
  
  res.json({ success: true });
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Функция для установки webhook
async function setupWebhook() {
  try {
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Webhook установлен: ${webhookUrl}`);
  } catch (error) {
    console.error('Ошибка установки webhook:', error);
  }
}

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  
  // Устанавливаем webhook при запуске
  if (process.env.NODE_ENV === 'production') {
    await setupWebhook();
  } else {
    console.log('Режим разработки - используется polling');
    bot.launch();
  }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
