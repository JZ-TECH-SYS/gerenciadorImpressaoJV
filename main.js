const { app, screen ,Menu, Tray, BrowserWindow, Notification } = require('electron');
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const store = new Store();

let settingsWindow;
let mainTray;

function createSettingsWindow() {
    settingsWindow = new BrowserWindow({
        width: 500,
        height: 300,
        webPreferences: {
            nodeIntegration: true,
            preload: path.join(__dirname, 'src', 'loads','preload.js')
        }
    });
    settingsWindow.loadFile(path.resolve(__dirname, 'assets', 'html', 'settings.html'));

    settingsWindow.on('close', (event) => {
        console.log('Evento de fechamento acionado para settingsWindow');
    });
    settingsWindow.on('closed', () => {
        console.log('Evento de janela fechada acionado para settingsWindow');
    });
}

process.on('uncaughtException', (error) => {
    new Notification({
        title: 'Erro',
        body: 'Erro não tratado:'+ error.message
    }).show();

    console.error('Erro não tratado:', error.message);
});


app.on('ready', () => {
    mainTray = new Tray(path.resolve(__dirname, 'assets', 'iconTemplate@2x.png'));
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Configurações',
            click: createSettingsWindow
        },
        {
          type: 'normal',
          label: 'Fechar',
          role: 'quit',
        }
        
    ]);
    mainTray.setContextMenu(contextMenu);
});

app.on('window-all-closed', (e) => {
    e.preventDefault();
});