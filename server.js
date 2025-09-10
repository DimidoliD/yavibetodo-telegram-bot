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
    features: ['delegation', 'notifications', 'deadlines', 'collaboration', 'task-status']
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

// Функция синхронизации задач между пользователями
function syncTaskBetweenUsers(taskId, updatedTask) {
  // Обновляем задачу везде где она есть
  for (const [userId, user] of userData) {
    // Обновляем в личных задачах
    const personalIndex = user.todos.findIndex(t => t.id === taskId);
    if (personalIndex !== -1) {
      user.todos[personalIndex] = { ...user.todos[personalIndex], ...updatedTask };
      userData.set(userId, user);
    }
    
    // Обновляем в назначенных задачах
    const assignedIndex = user.assignedTasks.findIndex(t => t.id === taskId);
    if (assignedIndex !== -1) {
      user.assignedTasks[assignedIndex] = { ...user.assignedTasks[assignedIndex], ...updatedTask };
      userData.set(userId, user);
    }
    
    // Обновляем в делегированных задачах
    const delegatedIndex = user.delegatedTasks.findIndex(t => t.id === taskId);
    if (delegatedIndex !== -1) {
      user.delegatedTasks[delegatedIndex] = { ...user.delegatedTasks[delegatedIndex], ...updatedTask };
      userData.set(userId, user);
    }
  }
}

// Функция удаления задачи из всех мест
function deleteTaskFromAllUsers(taskId) {
  let deletedCount = 0;
  
  for (const [userId, user] of userData) {
    // Удаляем из личных задач
    const personalIndex = user.todos.findIndex(t => t.id === taskId);
    if (personalIndex !== -1) {
      user.todos.splice(personalIndex, 1);
      deletedCount++;
    }
    
    // Удаляем из назначенных задач
    const assignedIndex = user.assignedTasks.findIndex(t => t.id === taskId);
    if (assignedIndex !== -1) {
      user.assignedTasks.splice(assignedIndex, 1);
      deletedCount++;
    }
    
    // Удаляем из делегированных задач
    const delegatedIndex = user.delegatedTasks.findIndex(t => t.id === taskId);
    if (delegatedIndex !== -1) {
      user.delegatedTasks.splice(delegatedIndex, 1);
      deletedCount++;
    }
    
    if (personalIndex !== -1 || assignedIndex !== -1 || delegatedIndex !== -1) {
      userData.set(userId, user);
    }
  }
  
  return deletedCount > 0;
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
⚡ Управляйте статусами задач

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
      const status = task.status ? getStatusEmoji(task.status) : '📋';
      
      message += `${index + 1}. ${isOverdue ? '🔴' : status} ${task.text}${deadline}\n`;
      if (task.assignedBy) {
        message += `   👤 От: ${task.assignedBy.first_name}\n`;
      }
      if (task.status && task.status !== 'todo') {
        message += `   📊 Статус: ${getStatusText(task.status)}\n`;
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
      const status = task.status ? ` (${getStatusText(task.status)})` : '';
      
      message += `${index + 1}. ${task.text}\n`;
      message += `   👤 Исполнитель: ${task.assignedTo.first_name}${status}`;
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

// Функции для работы со статусами
function getStatusEmoji(status) {
  switch (status) {
    case 'todo': return '📋';
    case 'in_progress': return '⚡';
    case 'review': return '👀';
    default: return '📋';
  }
}

function getStatusText(status) {
  switch (status) {
    case 'todo': return 'К выполнению';
    case 'in_progress': return 'В работе';
    case 'review': return 'На проверке';
    default: return 'К выполнению';
  }
}

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
    status: 'todo', // Добавляем начальный статус
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
  
  // Синхронизируем изменения между всеми пользователями
  syncTaskBetweenUsers(parseInt(todoId), todo);
  
  res.json(todo);
});

// НОВЫЙ endpoint для обновления статуса задачи
app.put('/api/todos/:todoId/status', async (req, res) => {
  try {
    const { todoId } = req.params;
    const { userId, status } = req.body;
    
    if (!userId || !status) {
      return res.status(400).json({ error: 'UserId и status обязательны' });
    }
    
    // Проверяем валидность статуса
    const validStatuses = ['todo', 'in_progress', 'review'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Неверный статус' });
    }
    
    const user = userData.get(parseInt(userId));
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Ищем задачу среди назначенных пользователю
    const todo = user.assignedTasks.find(t => t.id === parseInt(todoId));
    
    if (!todo) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }

    // Обновляем статус
    const oldStatus = todo.status;
    todo.status = status;
    todo.updatedAt = new Date().toISOString();
    
    // Синхронизируем изменения между всеми пользователями
    syncTaskBetweenUsers(parseInt(todoId), { 
      status: status, 
      updatedAt: todo.updatedAt 
    });
    
    // Уведомляем назначившего об изменении статуса
    if (todo.assignedBy && oldStatus !== status) {
      const assigner = userData.get(todo.assignedBy.id);
      if (assigner && assigner.notifications.enabled) {
        const statusText = getStatusText(status);
        await sendNotification(
          assigner.id,
          `📊 <b>Изменен статус задачи:</b>\n\n"${todo.text}"\n\n👤 Исполнитель: ${user.first_name}\n📈 Новый статус: ${statusText}`,
          {
            inline_keyboard: [[
              { text: '📝 Открыть приложение', web_app: { url: MINI_APP_URL } }
            ]]
          }
        );
      }
    }
    
    res.json({ 
      success: true, 
      status: status,
      message: `Статус изменен на: ${getStatusText(status)}`
    });
    
  } catch (error) {
    console.error('Ошибка обновления статуса:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// ИСПРАВЛЕННЫЙ endpoint удаления задачи
app.delete('/api/todos/:todoId', async (req, res) => {
  try {
    const { todoId } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'UserId обязателен' });
    }
    
    const user = userData.get(parseInt(userId));
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const taskId = parseInt(todoId);
    
    // Ищем задачу для получения информации о назначении
    let taskToDelete = null;
    let taskLocation = null;
    
    // Проверяем личные задачи
    const personalIndex = user.todos.findIndex(todo => todo.id === taskId);
    if (personalIndex !== -1) {
      taskToDelete = user.todos[personalIndex];
      taskLocation = 'personal';
    }
    
    // Проверяем назначенные задачи
    if (!taskToDelete) {
      const assignedIndex = user.assignedTasks.findIndex(todo => todo.id === taskId);
      if (assignedIndex !== -1) {
        taskToDelete = user.assignedTasks[assignedIndex];
        taskLocation = 'assigned';
      }
    }
    
    // Проверяем делегированные задачи
    if (!taskToDelete) {
      const delegatedIndex = user.delegatedTasks.findIndex(todo => todo.id === taskId);
      if (delegatedIndex !== -1) {
        taskToDelete = user.delegatedTasks[delegatedIndex];
        taskLocation = 'delegated';
      }
    }

    if (!taskToDelete) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }

    // Удаляем задачу из всех мест где она может быть
    const wasDeleted = deleteTaskFromAllUsers(taskId);
    
    if (!wasDeleted) {
      return res.status(404).json({ error: 'Задача не найдена для удаления' });
    }
    
    // Уведомляем связанных пользователей об удалении
    if (taskToDelete.assignedTo && taskToDelete.assignedBy) {
      // Если задачу удаляет назначивший
      if (taskToDelete.assignedBy.id === parseInt(userId)) {
        if (taskToDelete.assignedTo.id !== parseInt(userId)) {
          await sendNotification(
            taskToDelete.assignedTo.id,
            `🗑️ <b>Задача отменена:</b>\n\n"${taskToDelete.text}"\n\n👤 Отменил: ${user.first_name}`
          );
        }
      }
      // Если задачу удаляет исполнитель
      else if (taskToDelete.assignedTo.id === parseInt(userId)) {
        if (taskToDelete.assignedBy.id !== parseInt(userId)) {
          await sendNotification(
            taskToDelete.assignedBy.id,
            `🗑️ <b>Задача отклонена исполнителем:</b>\n\n"${taskToDelete.text}"\n\n👤 Отклонил: ${user.first_name}`
          );
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Задача успешно удалена',
      deletedTaskId: taskId
    });
    
  } catch (error) {
    console.error('Ошибка удаления задачи:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера при удалении задачи' });
  }
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
          const status = todo.status ? ` (${getStatusText(todo.status)})` : '';
          return `${i + 1}. ${isOverdue ? '🔴' : '🟡'} ${todo.text}${status}\n   📅 ${deadline.toLocaleDateString('ru')}`;
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
  console.log(`📊 Новые функции: статусы задач, улучшенное удаление`);
  
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
