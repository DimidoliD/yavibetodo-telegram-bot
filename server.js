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

// Временное хранилище данных
const userData = new Map();
const sharedTasks = new Map();
const usersByUsername = new Map();

// Middleware
app.use(cors({
  origin: '*',
  credentials: false
}));
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Ya Vibe Todo Collaboration Server is running!', 
    users: userData.size,
    sharedTasks: sharedTasks.size,
    features: ['delegation', 'notifications', 'deadlines', 'collaboration']
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
  const user = {
    id: telegramUser.id,
    first_name: telegramUser.first_name,
    last_name: telegramUser.last_name,
    username: telegramUser.username,
    todos: [],
    assignedTasks: [], // Задачи назначенные этому пользователю
    delegatedTasks: [], // Задачи которые этот пользователь назначил другим
    contacts: [], // Список контактов для делегирования
    notifications: {
      enabled: true,
      deadlineReminder: true,
      taskAssigned: true,
      taskCompleted: true
    },
    stats: {
      totalCompleted: 0,
      delegatedCompleted: 0,
      onTimeCompletion: 0,
      lateCompletion: 0
    },
    created_at: new Date()
  };

  // Индексируем по username для быстрого поиска
  if (telegramUser.username) {
    usersByUsername.set(telegramUser.username.toLowerCase(), telegramUser.id);
  }

  return user;
}

// Функция отправки уведомления пользователю
async function sendNotification(userId, message, keyboard = null) {
  try {
    const options = { parse_mode: 'HTML' };
    if (keyboard) {
      options.reply_markup = keyboard;
    }
    await bot.telegram.sendMessage(userId, message, options);
  } catch (error) {
    console.error(`Ошибка отправки уведомления пользователю ${userId}:`, error);
  }
}

// Функция поиска пользователя по username
function findUserByUsername(username) {
  const userId = usersByUsername.get(username.toLowerCase().replace('@', ''));
  return userId ? userData.get(userId) : null;
}

// Webhook endpoint для Telegram
app.use(bot.webhookCallback('/webhook'));

// Команды бота
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const user = ctx.from;
  
  if (!userData.has(userId)) {
    userData.set(userId, createUser(user));
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📝 Открыть Ya Vibe Todo',
            web_app: { url: MINI_APP_URL }
          }
        ],
        [
          { text: '👥 Мои задачи', callback_data: 'my_tasks' },
          { text: '📤 Назначенные мной', callback_data: 'delegated_tasks' }
        ],
        [
          { text: '📊 Статистика', callback_data: 'stats' },
          { text: '⚙️ Настройки', callback_data: 'settings' }
        ]
      ]
    }
  };

  const welcomeMessage = `🎉 Добро пожаловать в Ya Vibe Todo, ${user.first_name}!

🚀 Теперь с поддержкой командной работы:

✅ Создавайте и делегируйте задачи
👥 Назначайте исполнителей
📅 Устанавливайте дедлайны
🔔 Получайте уведомления
📊 Отслеживайте прогресс команды

${user.username ? `Ваш @${user.username} готов для получения задач от коллег!` : '⚠️ Установите username в настройках Telegram для получения задач от других пользователей'}`;

  ctx.reply(welcomeMessage, keyboard);
});

// Обработка callback queries
bot.action('my_tasks', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  if (!user) {
    ctx.answerCbQuery('Пользователь не найден');
    return;
  }

  const assignedTasks = user.assignedTasks || [];
  const pendingTasks = assignedTasks.filter(task => !task.completed);
  const overdueTasks = pendingTasks.filter(task => 
    task.deadline && new Date(task.deadline) < new Date()
  );

  let message = `📋 Ваши задачи:\n\n`;
  
  if (pendingTasks.length === 0) {
    message += '✨ Все задачи выполнены!\n';
  } else {
    pendingTasks.slice(0, 5).forEach((task, index) => {
      const deadline = task.deadline ? 
        `\n📅 До: ${new Date(task.deadline).toLocaleDateString('ru')}` : '';
      const isOverdue = task.deadline && new Date(task.deadline) < new Date();
      
      message += `${index + 1}. ${isOverdue ? '🔴' : '🔵'} ${task.text}${deadline}\n`;
      if (task.assignedBy) {
        message += `   👤 От: ${task.assignedBy.first_name}\n`;
      }
      message += '\n';
    });

    if (pendingTasks.length > 5) {
      message += `... и ещё ${pendingTasks.length - 5} задач\n\n`;
    }
  }

  if (overdueTasks.length > 0) {
    message += `⚠️ Просрочено: ${overdueTasks.length} задач\n`;
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 Открыть приложение', web_app: { url: MINI_APP_URL } }
        ],
        [
          { text: '🔙 Назад', callback_data: 'back_to_main' }
        ]
      ]
    }
  };

  ctx.editMessageText(message, keyboard);
  ctx.answerCbQuery();
});

bot.action('delegated_tasks', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  const delegatedTasks = user.delegatedTasks || [];
  const pendingTasks = delegatedTasks.filter(task => !task.completed);
  
  let message = `📤 Задачи назначенные вами:\n\n`;
  
  if (pendingTasks.length === 0) {
    message += 'Вы пока никому не назначали задачи.\n';
  } else {
    pendingTasks.slice(0, 5).forEach((task, index) => {
      const deadline = task.deadline ? 
        `📅 ${new Date(task.deadline).toLocaleDateString('ru')}` : '';
      
      message += `${index + 1}. ${task.text}\n`;
      message += `   👤 Исполнитель: ${task.assignedTo.first_name}`;
      if (deadline) message += `\n   ${deadline}`;
      message += '\n\n';
    });
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 Открыть приложение', web_app: { url: MINI_APP_URL } }
        ],
        [
          { text: '🔙 Назад', callback_data: 'back_to_main' }
        ]
      ]
    }
  };

  ctx.editMessageText(message, keyboard);
  ctx.answerCbQuery();
});

bot.action('stats', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  const totalTasks = user.todos.length + user.assignedTasks.length;
  const completedTasks = user.todos.filter(t => t.completed).length + 
                        user.assignedTasks.filter(t => t.completed).length;
  const delegatedTotal = user.delegatedTasks.length;
  const delegatedCompleted = user.delegatedTasks.filter(t => t.completed).length;
  
  const message = `📊 Ваша статистика:

📝 Личные задачи:
• Всего: ${user.todos.length}
• Выполнено: ${user.todos.filter(t => t.completed).length}

👥 Назначенные вам:
• Всего: ${user.assignedTasks.length}
• Выполнено: ${user.assignedTasks.filter(t => t.completed).length}

📤 Делегированные вами:
• Всего: ${delegatedTotal}
• Выполнено: ${delegatedCompleted}

🎯 Общий прогресс: ${totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0}%`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔙 Назад', callback_data: 'back_to_main' }
        ]
      ]
    }
  };

  ctx.editMessageText(message, keyboard);
  ctx.answerCbQuery();
});

bot.action('settings', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  const message = `⚙️ Настройки уведомлений:

🔔 Уведомления: ${user.notifications.enabled ? 'Включены' : 'Выключены'}
📅 Напоминания о дедлайнах: ${user.notifications.deadlineReminder ? 'Да' : 'Нет'}
📋 Новые назначенные задачи: ${user.notifications.taskAssigned ? 'Да' : 'Нет'}
✅ Выполнение задач: ${user.notifications.taskCompleted ? 'Да' : 'Нет'}

${ctx.from.username ? `✅ Username: @${ctx.from.username}` : '⚠️ Установите username в настройках Telegram'}`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: user.notifications.enabled ? '🔕 Выключить уведомления' : '🔔 Включить уведомления', 
            callback_data: 'toggle_notifications' }
        ],
        [
          { text: '🔙 Назад', callback_data: 'back_to_main' }
        ]
      ]
    }
  };

  ctx.editMessageText(message, keyboard);
  ctx.answerCbQuery();
});

bot.action('toggle_notifications', async (ctx) => {
  const userId = ctx.from.id;
  const user = userData.get(userId);
  
  user.notifications.enabled = !user.notifications.enabled;
  userData.set(userId, user);
  
  ctx.answerCbQuery(user.notifications.enabled ? 'Уведомления включены' : 'Уведомления выключены');
  
  // Возвращаемся к настройкам
  bot.handleUpdate({
    callback_query: {
      ...ctx.callbackQuery,
      data: 'settings'
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
            text: '📝 Открыть Ya Vibe Todo',
            web_app: { url: MINI_APP_URL }
          }
        ],
        [
          { text: '👥 Мои задачи', callback_data: 'my_tasks' },
          { text: '📤 Назначенные мной', callback_data: 'delegated_tasks' }
        ],
        [
          { text: '📊 Статистика', callback_data: 'stats' },
          { text: '⚙️ Настройки', callback_data: 'settings' }
        ]
      ]
    }
  };

  ctx.editMessageText(`🎉 Ya Vibe Todo - ${user.first_name}!\n\nВыберите действие:`, keyboard);
  ctx.answerCbQuery();
});

// API endpoints

// Получение пользователя и его данных
app.post('/api/user', (req, res) => {
  const { initData } = req.body;
  
  if (!initData) {
    // Режим разработки
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
      assignedTasks: user.assignedTasks,
      delegatedTasks: user.delegatedTasks,
      contacts: user.contacts
    });
  }

  const isValid = process.env.NODE_ENV === 'development' || verifyTelegramWebAppData(initData);
  
  if (!isValid) {
    return res.status(401).json({ error: 'Неверные данные Telegram' });
  }

  const user = getUserFromTelegramData(initData);
  if (!user) {
    return res.status(400).json({ error: 'Не удалось получить данные пользователя' });
  }

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
    assignedTasks: userData_user.assignedTasks,
    delegatedTasks: userData_user.delegatedTasks,
    contacts: userData_user.contacts
  });
});

// Создание новой задачи
app.post('/api/todos', async (req, res) => {
  const { userId, text, priority = 'medium', deadline, assignedTo } = req.body;
  
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
    deadline: deadline || null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    createdBy: {
      id: user.id,
      first_name: user.first_name,
      username: user.username
    }
  };

  if (assignedTo) {
    // Задача назначается другому пользователю
    const assignee = findUserByUsername(assignedTo);
    if (!assignee) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    newTodo.assignedTo = {
      id: assignee.id,
      first_name: assignee.first_name,
      username: assignee.username
    };
    newTodo.assignedBy = {
      id: user.id,
      first_name: user.first_name,
      username: user.username
    };

    // Добавляем в список назначенных задач получателя
    assignee.assignedTasks = assignee.assignedTasks || [];
    assignee.assignedTasks.push(newTodo);
    userData.set(assignee.id, assignee);

    // Добавляем в список делегированных задач отправителя
    user.delegatedTasks = user.delegatedTasks || [];
    user.delegatedTasks.push(newTodo);
    userData.set(user.id, user);

    // Отправляем уведомление
    if (assignee.notifications.enabled && assignee.notifications.taskAssigned) {
      const deadlineText = deadline ? 
        `\n📅 Дедлайн: ${new Date(deadline).toLocaleDateString('ru')}` : '';
      
      await sendNotification(
        assignee.id,
        `📋 <b>Новая задача от ${user.first_name}:</b>\n\n${text}${deadlineText}`,
        {
          inline_keyboard: [[
            { text: '📝 Открыть приложение', web_app: { url: MINI_APP_URL } }
          ]]
        }
      );
    }
  } else {
    // Личная задача
    user.todos.push(newTodo);
    userData.set(parseInt(userId), user);
  }

  res.json(newTodo);
});

// Обновление задачи
app.put('/api/todos/:todoId', async (req, res) => {
  const { todoId } = req.params;
  const { userId, completed, text, priority, deadline } = req.body;
  
  const user = userData.get(parseInt(userId));
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  // Ищем задачу в личных задачах или назначенных
  let todo = user.todos.find(t => t.id === parseInt(todoId));
  let isPersonalTask = true;
  
  if (!todo) {
    todo = user.assignedTasks.find(t => t.id === parseInt(todoId));
    isPersonalTask = false;
  }

  if (!todo) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }

  const wasCompleted = todo.completed;

  // Обновляем поля
  if (completed !== undefined) {
    todo.completed = completed;
    if (completed && !wasCompleted) {
      todo.completedAt = new Date().toISOString();
      user.stats.totalCompleted++;
      
      // Уведомляем назначившего о выполнении
      if (!isPersonalTask && todo.assignedBy) {
        const assigner = userData.get(todo.assignedBy.id);
        if (assigner && assigner.notifications.enabled && assigner.notifications.taskCompleted) {
          await sendNotification(
            assigner.id,
            `✅ <b>Задача выполнена!</b>\n\n"${todo.text}"\n\n👤 Исполнитель: ${user.first_name}`
          );
        }
        
        // Обновляем статистику назначившего
        if (assigner) {
          assigner.stats.delegatedCompleted++;
          userData.set(assigner.id, assigner);
        }
      }
    } else if (!completed && wasCompleted) {
      todo.completedAt = null;
      user.stats.totalCompleted = Math.max(0, user.stats.totalCompleted - 1);
    }
  }
  
  if (text !== undefined) todo.text = text.trim();
  if (priority !== undefined) todo.priority = priority;
  if (deadline !== undefined) todo.deadline = deadline;
  
  todo.updatedAt = new Date().toISOString();
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

  // Удаляем из личных задач
  let todoIndex = user.todos.findIndex(todo => todo.id === parseInt(todoId));
  if (todoIndex !== -1) {
    user.todos.splice(todoIndex, 1);
    userData.set(parseInt(userId), user);
    return res.json({ success: true });
  }

  // Удаляем из назначенных задач
  todoIndex = user.assignedTasks.findIndex(todo => todo.id === parseInt(todoId));
  if (todoIndex !== -1) {
    user.assignedTasks.splice(todoIndex, 1);
    userData.set(parseInt(userId), user);
    return res.json({ success: true });
  }

  res.status(404).json({ error: 'Задача не найдена' });
});

// Поиск пользователей для делегирования
app.get('/api/users/search', (req, res) => {
  const { query } = req.query;
  
  if (!query || query.length < 2) {
    return res.json([]);
  }

  const results = [];
  const searchQuery = query.toLowerCase().replace('@', '');
  
  for (const [userId, user] of userData) {
    if (user.username && user.username.toLowerCase().includes(searchQuery)) {
      results.push({
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username
      });
    }
    
    if (results.length >= 10) break; // Ограничиваем результаты
  }
  
  res.json(results);
});

// Получение контактов пользователя
app.get('/api/contacts/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = userData.get(userId);
  
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  res.json(user.contacts || []);
});

// Периодическая проверка дедлайнов
setInterval(async () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0); // 9 утра завтра

  for (const [userId, user] of userData) {
    if (!user.notifications.enabled || !user.notifications.deadlineReminder) continue;

    // Проверяем личные задачи
    const personalOverdue = user.todos.filter(todo => 
      !todo.completed && todo.deadline && 
      new Date(todo.deadline) <= tomorrow
    );

    // Проверяем назначенные задачи
    const assignedOverdue = user.assignedTasks.filter(todo => 
      !todo.completed && todo.deadline && 
      new Date(todo.deadline) <= tomorrow
    );

    const allOverdue = [...personalOverdue, ...assignedOverdue];

    if (allOverdue.length > 0) {
      const message = `⏰ <b>Напоминание о дедлайнах!</b>\n\nЗадачи требующие внимания:\n\n${
        allOverdue.slice(0, 3).map((todo, i) => {
          const deadline = new Date(todo.deadline);
          const isOverdue = deadline < now;
          return `${i + 1}. ${isOverdue ? '🔴' : '🟡'} ${todo.text}\n   📅 ${deadline.toLocaleDateString('ru')}`;
        }).join('\n\n')
      }`;

      await sendNotification(userId, message, {
        inline_keyboard: [[
          { text: '📝 Открыть приложение', web_app: { url: MINI_APP_URL } }
        ]]
      });
    }
  }
}, 60 * 60 * 1000); // Проверяем каждый час

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
  console.log(`🚀 Ya Vibe Todo Collaboration Server запущен на порту ${PORT}`);
  console.log(`📱 Mini App URL: ${MINI_APP_URL}`);
  console.log(`👥 Поддержка командной работы активна`);
  
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
