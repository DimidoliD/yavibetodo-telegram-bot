const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Ваш токен бота
const BOT_TOKEN = '8127780450:AAHaerKpn5LKutGijkLsRIxdFloqG4hz9Eg';
const bot = new Telegraf(BOT_TOKEN);

// URL вашего мини-апп
const MINI_APP_URL = 'https://yavibetodo-telegram-539l.bolt.host';

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Bot server is running!' });
});

// Webhook endpoint для Telegram
app.use(bot.webhookCallback('/webhook'));

// Команды бота
bot.start((ctx) => {
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
    'Добро пожаловать в Ya Vi Be Todo! 🎉\n\nНажмите кнопку ниже, чтобы открыть приложение:',
    keyboard
  );
});

bot.help((ctx) => {
  ctx.reply(
    'Доступные команды:\n' +
    '/start - Запустить приложение\n' +
    '/help - Показать эту справку\n' +
    '/app - Открыть Todo приложение'
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

// API endpoints для мини-апп
app.get('/api/todos', (req, res) => {
  // Здесь будет логика получения задач
  res.json([
    { id: 1, text: 'Пример задачи', completed: false }
  ]);
});

app.post('/api/todos', (req, res) => {
  // Здесь будет логика создания задач
  const { text } = req.body;
  const newTodo = {
    id: Date.now(),
    text: text,
    completed: false,
    createdAt: new Date()
  };
  res.json(newTodo);
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
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL || 'https://your-render-app.onrender.com'}/webhook`;
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
    // Для разработки используем polling
    console.log('Режим разработки - используется polling');
    bot.launch();
  }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
