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
const MINI_APP_URL = 'https://dimidolid.github.io/yavibetodo-frontend/';

// Временное хранилище данных (в продакшене используйте базу данных)
const userData = new Map();
const sharedLists = new Map();

// Middleware
app.use(cors({
  origin: ['https://dimidolid.github.io', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Ya Vi Be Todo Server is running!', 
    users: userData.size,
    features: ['categories', 'priorities', 'deadlines', 'subtasks', 'analytics', 'notifications', 'collaboration']
  });
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

// Создание нового пользователя
function createUser(telegramUser) {
  return {
    id: telegramUser.id,
    first_name: telegramUser.first_name,
    last_name: telegramUser.last_name,
    username: telegramUser.username,
    todos: [],
    categories: [
      { id: 1, name: 'Работа', color: '#3b82f6', icon: '💼' },
      { id: 2, name: 'Личное', color: '#10b981', icon: '🏠' },
      { id: 3, name: 'Учеба', color: '#f59e0b', icon: '📚' },
      { id: 4, name: 'Здоровье', color: '#ef4444', icon: '❤️' }
    ],
    habits: [],
    preferences: {
      theme: 'auto',
      notifications: true,
      defaultPriority: 'medium',
      sortBy: 'created',
      viewMode: 'list'
    },
    stats: {
      totalCompleted: 0,
      streakDays: 0,
      lastActivity: new Date(),
      completedToday: 0,
      weeklyStats: []
    },
    sharedLists: [],
    created_at: new Date()
  };
}

// Webhook endpoint для Telegram
app.use(bot.webhookCallback('/webhook'));

// Команды бота
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const user = ctx.from;
  
  // Сохраняем информацию о пользователе
  if (!userData.has(userId)) {
    userData.set(userId, createUser(user));
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📝 Открыть Ya Vi Be Todo',
            web_app: { url: MINI_APP_URL }
          }
        ],
        [
          { text: '📊 Статистика', callback_data: 'stats' },
          { text: '⚙️ Настройки', callback_data: 'settings' }
        ]
      ]
    }
  };

  const welcomeMessage = `🎉 Добро пожаловать в Ya Vi Be Todo, ${user.first_name}!

🚀 Ваш персональный менеджер задач с расширенными возможностями:

✅ Задачи с приоритетами и дедлайнами
🏷️ Категории и теги  
📊 Аналитика продуктивности
🔔 Умные уведомления
👥 Совместная работа
🎯 Трекинг привычек

Нажмите кнопку ниже, чтобы начать!`;

  ctx.reply(welcomeMessage, keyboard);
});

bot.action('stats', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (!user) {
    ctx.answerCbQuery('Пользователь не найден');
    return;
  }
  
  const total = user.todos.length;
  const completed = user.todos.filter(todo => todo.completed).length;
  const pending = total - completed;
  const completedToday = user.stats.completedToday;
  const streak = user.stats.streakDays;
  
  const statsMessage = `📊 Ваша статистика:

📝 Всего задач: ${total}
✅ Выполнено: ${completed}
⏳ В процессе: ${pending}
🔥 Серия: ${streak} дней
📅 Сегодня: ${completedToday}

🎯 Прогресс: ${total > 0 ? Math.round((completed / total) * 100) : 0}%

Откройте приложение для детальной аналитики!`;

  ctx.editMessageText(statsMessage, {
    reply_markup: {
      inline_keyboard: [[
        { text: '🔙 Назад', callback_data: 'back_to_main' }
      ]]
    }
  });
  ctx.answerCbQuery();
});

bot.action('settings', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  const settingsMessage = `⚙️ Настройки:

🎨 Тема: ${user.preferences.theme === 'auto' ? 'Авто' : user.preferences.theme === 'dark' ? 'Темная' : 'Светлая'}
🔔 Уведомления: ${user.preferences.notifications ? 'Включены' : 'Выключены'}
📋 Сортировка: ${user.preferences.sortBy === 'created' ? 'По дате создания' : user.preferences.sortBy === 'priority' ? 'По приоритету' : 'По дедлайну'}

Откройте приложение для более детальных настроек.`;

  ctx.editMessageText(settingsMessage, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: user.preferences.notifications ? '🔕 Выключить уведомления' : '🔔 Включить уведомления', callback_data: 'toggle_notifications' }
        ],
        [
          { text: '🔙 Назад', callback_data: 'back_to_main' }
        ]
      ]
    }
  });
  ctx.answerCbQuery();
});

bot.action('toggle_notifications', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  user.preferences.notifications = !user.preferences.notifications;
  userData.set(userId, user);
  
  ctx.answerCbQuery(user.preferences.notifications ? 'Уведомления включены' : 'Уведомления выключены');
  ctx.editMessageText(`✅ ${user.preferences.notifications ? 'Уведомления включены' : 'Уведомления выключены'}`, {
    reply_markup: {
      inline_keyboard: [[
        { text: '🔙 Назад', callback_data: 'settings' }
      ]]
    }
  });
});

bot.action('back_to_main', async (ctx) => {
  const user = ctx.from;
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📝 Открыть Ya Vi Be Todo',
            web_app: { url: MINI_APP_URL }
          }
        ],
        [
          { text: '📊 Статистика', callback_data: 'stats' },
          { text: '⚙️ Настройки', callback_data: 'settings' }
        ]
      ]
    }
  };

  ctx.editMessageText(`🎉 Ya Vi Be Todo - ${user.first_name}!\n\nВыберите действие:`, keyboard);
  ctx.answerCbQuery();
});

// API endpoints для мини-апп

// Получение пользователя и его данных
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
      userData.set(testUser.id, createUser(testUser));
    }

    const user = userData.get(testUser.id);
    return res.json({
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username
      },
      todos: user.todos,
      categories: user.categories,
      habits: user.habits,
      preferences: user.preferences,
      stats: user.stats
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
    userData.set(user.id, createUser(user));
  }

  const userData_user = userData.get(user.id);
  res.json({
    user: {
      id: userData_user.id,
      first_name: userData_user.first_name,
      last_name: userData_user.last_name,
      username: userData_user.username
    },
    todos: userData_user.todos,
    categories: userData_user.categories,
    habits: userData_user.habits,
    preferences: userData_user.preferences,
    stats: userData_user.stats
  });
});

// Создание новой задачи
app.post('/api/todos', (req, res) => {
  const { userId, text, priority = 'medium', categoryId, deadline, subtasks = [] } = req.body;
  
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
    priority: priority,
    categoryId: categoryId || null,
    deadline: deadline || null,
    subtasks: subtasks.map((subtask, index) => ({
      id: Date.now() + index,
      text: subtask.trim(),
      completed: false
    })),
    createdAt: new Date().toISOString(),
    completedAt: null,
    timeSpent: 0,
    tags: [],
    comments: []
  };

  user.todos.push(newTodo);
  userData.set(parseInt(userId), user);
  
  res.json(newTodo);
});

// Обновление задачи
app.put('/api/todos/:todoId', (req, res) => {
  const { todoId } = req.params;
  const { userId, completed, text, priority, categoryId, deadline, subtasks, timeSpent } = req.body;
  
  const user = userData.get(parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const todoIndex = user.todos.findIndex(todo => todo.id === parseInt(todoId));
  if (todoIndex === -1) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }

  const todo = user.todos[todoIndex];
  const wasCompleted = todo.completed;

  if (completed !== undefined) {
    todo.completed = completed;
    if (completed && !wasCompleted) {
      todo.completedAt = new Date().toISOString();
      user.stats.totalCompleted++;
      user.stats.completedToday++;
    } else if (!completed && wasCompleted) {
      todo.completedAt = null;
      user.stats.totalCompleted = Math.max(0, user.stats.totalCompleted - 1);
      user.stats.completedToday = Math.max(0, user.stats.completedToday - 1);
    }
  }
  
  if (text !== undefined) todo.text = text.trim();
  if (priority !== undefined) todo.priority = priority;
  if (categoryId !== undefined) todo.categoryId = categoryId;
  if (deadline !== undefined) todo.deadline = deadline;
  if (subtasks !== undefined) todo.subtasks = subtasks;
  if (timeSpent !== undefined) todo.timeSpent = timeSpent;
  
  todo.updatedAt = new Date().toISOString();
  user.stats.lastActivity = new Date();
  
  userData.set(parseInt(userId), user);
  
  res.json(todo);
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

// Управление категориями
app.post('/api/categories', (req, res) => {
  const { userId, name, color, icon } = req.body;
  
  const user = userData.get(parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const newCategory = {
    id: Date.now(),
    name: name.trim(),
    color: color || '#6366f1',
    icon: icon || '📝'
  };

  user.categories.push(newCategory);
  userData.set(parseInt(userId), user);
  
  res.json(newCategory);
});

// Удаление категории
app.delete('/api/categories/:categoryId', (req, res) => {
  const { categoryId } = req.params;
  const { userId } = req.body;
  
  const user = userData.get(parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const categoryIndex = user.categories.findIndex(cat => cat.id === parseInt(categoryId));
  if (categoryIndex === -1) {
    return res.status(404).json({ error: 'Категория не найдена' });
  }

  user.categories.splice(categoryIndex, 1);
  userData.set(parseInt(userId), user);
  
  res.json({ success: true });
});

// Обновление категории
app.put('/api/categories/:categoryId', (req, res) => {
  const { categoryId } = req.params;
  const { userId, name, color, icon } = req.body;
  
  const user = userData.get(parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const categoryIndex = user.categories.findIndex(cat => cat.id === parseInt(categoryId));
  if (categoryIndex === -1) {
    return res.status(404).json({ error: 'Категория не найдена' });
  }

  if (name !== undefined) user.categories[categoryIndex].name = name.trim();
  if (color !== undefined) user.categories[categoryIndex].color = color;
  if (icon !== undefined) user.categories[categoryIndex].icon = icon;
  
  userData.set(parseInt(userId), user);
  
  res.json(user.categories[categoryIndex]);
});

// Получение аналитики
app.get('/api/analytics/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const { period = 'week' } = req.query;
  
  const user = userData.get(userId);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const now = new Date();
  const todos = user.todos;
  
  // Статистика по категориям
  const categoryStats = user.categories.map(category => {
    const categoryTodos = todos.filter(todo => todo.categoryId === category.id);
    return {
      category: category,
      total: categoryTodos.length,
      completed: categoryTodos.filter(todo => todo.completed).length,
      pending: categoryTodos.filter(todo => !todo.completed).length
    };
  });

  // Статистика по приоритетам
  const priorityStats = ['high', 'medium', 'low'].map(priority => ({
    priority,
    total: todos.filter(todo => todo.priority === priority).length,
    completed: todos.filter(todo => todo.priority === priority && todo.completed).length
  }));

  // Временная статистика
  const timeStats = {
    totalTimeSpent: todos.reduce((sum, todo) => sum + (todo.timeSpent || 0), 0),
    avgTimePerTask: todos.length ? todos.reduce((sum, todo) => sum + (todo.timeSpent || 0), 0) / todos.length : 0,
    completedToday: user.stats.completedToday,
    streak: user.stats.streakDays
  };

  res.json({
    overview: {
      total: todos.length,
      completed: todos.filter(todo => todo.completed).length,
      pending: todos.filter(todo => !todo.completed).length,
      overdue: todos.filter(todo => !todo.completed && todo.deadline && new Date(todo.deadline) < now).length
    },
    categoryStats,
    priorityStats,
    timeStats,
    trends: user.stats.weeklyStats || []
  });
});

// Обновление настроек
app.put('/api/preferences/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const preferences = req.body;
  
  const user = userData.get(userId);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  user.preferences = { ...user.preferences, ...preferences };
  userData.set(userId, user);
  
  res.json(user.preferences);
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
  console.log(`🚀 Ya Vi Be Todo Server запущен на порту ${PORT}`);
  console.log(`📱 Mini App URL: ${MINI_APP_URL}`);
  
  // Устанавливаем webhook при запуске
  if (process.env.NODE_ENV === 'production') {
    await setupWebhook();
  } else {
    console.log('🔧 Режим разработки - используется polling');
    bot.launch();
  }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
