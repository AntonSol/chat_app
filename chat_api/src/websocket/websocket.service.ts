import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';
import * as fs from 'node:fs';
import { Room } from './entities/room.entity';
import { Message } from './entities/message.entity';
import { isJSON } from 'class-validator';
import * as path from 'path';
import { Injectable } from '@nestjs/common';

@Injectable()
export class WebsocketService {
  constructor(
    @InjectRepository(User)
    private UserTable: Repository<User>,

    @InjectRepository(Room)
    private RoomTable: Repository<Room>,

    @InjectRepository(Message)
    private MessageTable: Repository<Message>
  ) {}

  clients = {};
  messages = [];
  gameRooms = {};
  stateGames = {};
  publicChatEvent = 'message' as 'message';
  privateChatEvent = 'private_message' as 'private_message';

  async updatedClientsAfterUpdateDataBase(user: any) {
    try {
      const searchedUser = this.clients[user.id];
      if (user && searchedUser) {
        searchedUser.userPhoto = user.userPhoto;
      }
    } catch (e) {
      console.log(e);
    }
  }

  async getAllMessagesPublicChat(userId: string) {
    const client = this.clients[userId];
    for (let i = 0; i < this.messages.length; i++) {
      client.client.emit('message', {
        messages: this.messages[i],
        lengthMessages: this.messages.length,
      });
    }
  }

  async disconnectUser(disconnectedClient: any) {
    // Удаляем клиента который отключился
    delete this.clients[disconnectedClient.handshake.query.userID];

    const sendClients = [];

    for (const clientId in this.clients) {
      sendClients.push({
        id: clientId,
        name: this.clients[clientId].name,
      });
    }

    for (const game in this.gameRooms) {
      const currentGame = this.gameRooms[game];
      const currentUser = currentGame.users.find(
        (user: { id: string; name: string; userPhoto: string; client: any }) =>
          user.id === disconnectedClient.handshake.query.userID
      );
      currentUser.isOnline = false;
    }
    // {
    //   game: 'ticTacToe',
    //   isAllChat: false,
    //   id: '60b60c2e-e984-429d-8247-a769b01173ed-38505046-f277-48c8-9f55-7f6c351a2e64',
    //   users: [
    //     {
    //       id: '60b60c2e-e984-429d-8247-a769b01173ed',
    //       name: 'rove',
    //       userPhoto: 'D:\\Programming\\my-projects\\chat_app\\chat_api\\dist\\static\\image\\default_photo_user.webp',
    //       client: [Socket]
    //     },
    //     {
    //       id: '38505046-f277-48c8-9f55-7f6c351a2e64',
    //       name: 'IGOR',
    //       userPhoto: 'D:\\Programming\\my-projects\\chat_app\\chat_api\\dist\\static\\image\\default_photo_user.webp',
    //       client: [Socket]
    //     }
    //   ]
    // }
    console.log('Client disconnect');
    return { sendClients };
  }

  async connectedUser(client: any) {
    // Вытаскием id с квери параметров
    const userId = client.handshake.query.userID;
    // Ищем пользака по этому id
    const user = await this.UserTable.findOneBy({
      id: userId,
    });
    // Если пользака нет в обьекте клиентов веб сокетов, то добавляем его туда
    if (!this.clients[userId]) {
      this.clients[userId] = {
        id: userId,
        name: user.name,
        userPhoto: user.userPhoto,
        client,
      };
    }

    // Добавляет обьекту клиента веб сокета id, для успешной идентификации и удаления при дисконнекте
    // client['userId'] = userId;

    // Создаем новый массив для отправки подключенных пользователей на клиент
    const sendClients = [];

    for (const clientId in this.clients) {
      sendClients.push({
        id: clientId,
        name: this.clients[clientId].name,
      });
    }

    // При подключении определенного клиента, отправляем список всех пользователей и себя в частности, на клиент
    // for (const clientId in this.clients) {
    //   console.log(this.clients[clientId].client);
    //   this.clients[clientId].client.emit(
    //     'test',
    //     JSON.stringify({ clients: sendClients }),
    //   );
    // }

    for (let i = 0; i <= this.messages.length; i++) {
      client.emit('message', {
        messages: this.messages[i],
        lengthMessages: this.messages.length,
      });
    }

    return { sendClients };
  }

  async broadcastMessage(userId: any, message: string | Array<[]>, roomId: string, isAllChat: boolean) {
    const user = this.clients[userId];
    const maxMessageSize = 300 * 1024; // Максимальный размер сообщения для изобращения

    if (Array.isArray(message) && message.length >= maxMessageSize) {
      return; // Отклоните слишком большое сообщение
    }

    if (message === '') return; // Отклоните пустое сообщение

    const sendData = {
      message: message,
      userId: user.id,
      name: user.name.trim(),
      userPhoto: '',
      roomId: roomId,
      isAllChat: isAllChat,
    };

    try {
      const result = await fs.promises.readFile(user.userPhoto, 'base64');
      sendData.userPhoto = result;
    } catch (e) {
      sendData.userPhoto = '';
    }

    const messages = { messages: sendData };

    if (isAllChat) {
      if (this.messages.length < 20) {
        this.messages.push(sendData);
      } else {
        this.messages.pop();
        this.messages.push(sendData);
      }
      return messages;
    } else {
      const room = await this.RoomTable.findOne({
        where: { id: roomId },
        relations: ['users'],
      }); // получаем пользаков данной комнаты.

      let messageToSaveDB: string | Array<[]>;

      if (Array.isArray(message)) {
        messageToSaveDB = JSON.stringify(message);
      } else {
        messageToSaveDB = message.trim();
      } // Нужно добавить поддержку отправку фото в личку
      const newMessage = new Message();
      newMessage.message = messageToSaveDB;
      newMessage.name = user.name;
      newMessage.userId = user.id;
      // newMessage.userPhoto = user.userPhoto;
      newMessage.room = room;
      await this.MessageTable.save(newMessage);
      // let roomMessages = await this.RoomTable.createQueryBuilder('room')
      //   .leftJoinAndSelect('room.messages', 'message1')
      //   .where('message1.roomId = :roomId', { roomId: room.id })
      //   .getOne(); // получение пака сообщений из подтаблицы Message, если их нет то null

      for (let user of room.users) {
        if (this.clients[user.id]) {
          this.clients[user.id].client.emit('message', messages);
        }
      }
    }
  }

  async openPrivateRoom(myId: string, userId: string) {
    const creator = await this.UserTable.findOneBy({ id: myId });
    const userToAdd = await this.UserTable.findOneBy({ id: userId });

    const dirname = process.cwd();
    const defaultImagePath = path.join(dirname, 'dist', 'static', 'image', 'default_photo_user.webp');
    const client = this.clients[myId];

    // Получаем комнату в которой есть 2 пользователя, вы и пользователь собеседник
    let room = await this.RoomTable.createQueryBuilder('room')
      .innerJoin('room.users', 'user1') // Делает связь свойства сущности room с массивом подтаблицей users
      .innerJoin('room.users', 'user2') // Делает связь свойства сущности room с массивом подтаблицей users 2 раз
      .where('user1.id = :userId1 AND user2.id = :userId2', {
        userId1: creator.id,
        userId2: userToAdd.id,
      }) // ищем в подтаблице для данной комнаты наличие userId1 и userId2 и если есть возвращать комнату
      .getOne();

    if (!room) {
      // Создайте новую комнату и добавьте пользователей
      room = new Room();
      room.name = `${creator.name}_${userToAdd.name}`;
      room.users = [creator, userToAdd];
      room.messages = [];
      this.RoomTable.save(room);
    }

    let roomMessages = await this.RoomTable.createQueryBuilder('room')
      .leftJoinAndSelect('room.messages', 'message1')
      .where('message1.roomId = :roomId', { roomId: room.id })
      .getOne(); // получение пака сообщений из подтаблицы Message, если их нет то null

    if (!roomMessages) {
      client.client.emit('message', {
        lengthMessages: 0,
        userToAddPrivat: userToAdd.name,
        openRoom: true,
        messages: {
          roomId: room.id,
          roomName: room.name,
          event: this.privateChatEvent,
          messages: [],
        },
      });
      return;
    }

    for (let i = 0; i < roomMessages.messages.length; i++) {
      try {
        const currentUserPhotoPath =
          roomMessages.messages[i].userId === creator.id ? creator.userPhoto : userToAdd.userPhoto;

        const userPhoto = await fs.promises.readFile(
          fs.existsSync(currentUserPhotoPath) ? currentUserPhotoPath : defaultImagePath,
          'base64'
        );

        if (isJSON(roomMessages.messages[i].message)) {
          roomMessages.messages[i].message = JSON.parse(roomMessages.messages[i].message);
        }

        client.client.emit('message', {
          lengthMessages: roomMessages.messages.length,
          userToAddPrivat: userToAdd.name,
          openRoom: true,
          messages: {
            event: this.privateChatEvent,
            roomId: room.id,
            roomName: room.name,
            userPhoto,
            ...roomMessages.messages[i],
          },
        });
      } catch (e) {
        console.log(e);
      }
    }
  }

  async inviteGameUser(myId: string, userId: string, game: string, isAccept: boolean | undefined) {
    const you = this.clients[myId];
    const user = this.clients[userId];
    you.isOnline = false;
    user.isOnline = false;

    const sendInvite = {
      game,
      userSendedInvite: you.name,
      isAllChat: false,
      inviteGame: game,
      sendInviteUserId: myId,
    } as any;

    // Если "Подтверждёный статус" не приходит то отправить пользаку c userId приглашение,
    // Если пришёл "Статус подтверждено" то создать комнату и разослать
    // Приглашение в эту комнату двум игрокам
    switch (isAccept) {
      case undefined: {
        sendInvite.isInvite = true;
        user.client.emit('inviteGame', sendInvite);
        break;
      }
      case false: {
        user.client.emit('inviteGame', { ...sendInvite, isAccept });
        break;
      }
      case true: {
        const gameRoomId = myId + '-' + userId;

        this.gameRooms[gameRoomId] = {
          game,
          isAllChat: false,
          id: gameRoomId,
        };

        you.client.emit('inviteGame', {
          ...sendInvite,
          gameRoom: this.gameRooms[gameRoomId],
        });

        user.client.emit('inviteGame', {
          userSendedInvite: sendInvite.userSendedInvite,
          isAccept,
          gameRoom: this.gameRooms[gameRoomId],
        });

        // При инвайте добавляет только id и name от пользователей
        for (const client of [you, user]) {
          const tempPushedUser = {
            id: client.id,
            name: client.name,
            isOnline: false,
          };
          this.gameRooms[gameRoomId].users = this.gameRooms[gameRoomId].users || [];
          this.gameRooms[gameRoomId].users.push(tempPushedUser);
        }
        break;
      }
    }
  }

  async gameFlow(
    game: string,
    roomId: string,
    clickCell: { index: string; symbol: string },
    userId: string,
    isClear: string
  ) {
    try {
      // Берем текущую комнату в переменную
      const gameRoom = this.gameRooms[roomId];
      // Если в комнате на данный момент меньше 2х игроков, прибавлять к юзерам комнаты текущего игрока
      // Это помогает возвращаться в комнату при перезагрузке страницы
      // if (gameRoom.users.length < 2) {
      //   gameRoom.users.push(this.clients[userId]);
      // }
      switch (game) {
        case 'ticTacToe': {
          if (
            // Не пропускать нажатие на ячейку для одного и того же игрока
            (this.stateGames[game]?.nextMovedUser &&
              this.stateGames[game]?.nextMovedUser.id !== userId &&
              !isClear &&
              clickCell) ||
            (!isClear && this.stateGames[game]?.isWinnered)
          )
            return;

          // Если кликнуто по уже заполненой ячейки, то возврат
          if (this.stateGames[game] && clickCell && this.stateGames[game].board[clickCell.index] !== null) return;

          this.stateGames[game] = this.stateGames[game] || {};
          this.stateGames[game].board = this.stateGames[game].board || Array(9).fill(null);

          const userOne = gameRoom.users[0];
          const userTwo = gameRoom.users[1];

          this.stateGames[game].scores = this.stateGames[game].scores || {
            x: 0,
            o: 0,
          };

          const players = {
            [userOne?.id]: {
              name: userOne.name,
              symbol: 'x',
              score: this.stateGames[game].scores.x,
            },
            [userTwo?.id]: {
              name: userTwo.name,
              symbol: 'o',
              score: this.stateGames[game].scores.o,
            },
          };

          // Логика игры в крестики нолики
          let patternWinner = [];
          const winsPatterns = [
            [0, 4, 8],
            [2, 4, 6],
            [0, 1, 2],
            [3, 4, 5],
            [6, 7, 8],
            [0, 3, 6],
            [1, 4, 7],
            [2, 5, 8],
          ];
          let potencialWinner = '';
          let winner = '';

          // если кликнута ячейка
          if (clickCell) {
            // установка ход для следующего игрока
            const nextMoveUser = this.gameRooms[roomId].users.find(
              (user: any) => user.id !== this.stateGames[game].nextMovedUser.id
            );
            this.stateGames[game].nextMovedUser = { id: nextMoveUser.id, name: nextMoveUser.name };
            this.stateGames[game].board[clickCell.index] = clickCell.symbol;
            // перебор паттернов выйгрыша
            for (const pattern of winsPatterns) {
              let isWinner = pattern.every((el, indexEl) => {
                if (this.stateGames[game].board[el] === clickCell.symbol && indexEl === 0) {
                  potencialWinner = clickCell.symbol;
                  return true;
                }
                if (indexEl > 0) {
                  return this.stateGames[game].board[el] === potencialWinner;
                }
              });
              // выйгрыш
              if (isWinner) {
                patternWinner = pattern;
                winner = potencialWinner;
                this.stateGames[game].scores[winner] += 1;
                players[userId].score = this.stateGames[game].scores[winner];
                delete this.stateGames[game].nextMovedUser;
                this.stateGames[game].isWinnered = true;
                break;
                // если ничья
              } else if (this.stateGames[game].board.every((cell: any) => cell !== null)) {
                winner = 'ничья';
              }
            }
          }

          // Установка первого игрока при первом запуске
          if (!this.stateGames[game].nextMovedUser) {
            const nextMoveUser = this.gameRooms[roomId].users[0];
            this.stateGames[game].nextMovedUser = { id: nextMoveUser.id, name: nextMoveUser.name };
          }
          this.stateGames[game].nextMovedUser.symbol = players[this.stateGames[game].nextMovedUser.id].symbol;

          // eсли нажали очистить доску
          if (isClear) {
            this.stateGames[game].board = Array(9).fill(null);
            winner = '';
            this.stateGames[game].isWinnered = false;
            patternWinner = [];
          }

          // Передача пользователям этой комнаты игровых данных
          for (const { id, isOnline, name } of gameRoom.users) {
            // if (!isOnline) continue;
            this.clients[id].client.emit('gaming', {
              game: gameRoom.game,
              dataGame: {
                board: this.stateGames[game].board,
                players,
                nextMove: this.stateGames[game].nextMovedUser,
                patternWinner,
                winner,
              },
            });
          }
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  async gameRoom(action: 'enter' | 'leave', userId: string, roomId: string) {
    const currentUser = this.gameRooms[roomId].users.find((user: any) => user.id === userId);
    if (action === 'enter') currentUser.isOnline = true;
    else currentUser.isOnline = false;
    console.log('ВНУТРИ_СЕТ_РУМА');
  }
}
