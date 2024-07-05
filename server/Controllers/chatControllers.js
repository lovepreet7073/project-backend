const express = require("express");
const router = express.Router();
const User = require("../models/userSchema");
const Chat = require("../models/chatSchema");
const authenticate = require("../middleware/authenticate");
const Message = require("../models/MessageSchema");
const multer = require('multer');
const path = require('path');
const fs = require('fs');

exports.chatUsers = async (req, res) => {
  const keyword = req.query.search
    ? {
      $or: [
        { name: { $regex: req.query.search, $options: "i" } },
        { email: { $regex: req.query.search, $options: "i" } },
      ],
    }
    : {};

  const users = await User.find(keyword).find({ _id: { $ne: req.user._id } });
  res.send(users);
}

exports.createChat = async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.sendStatus(400);
  }

  try {
    const existingChat = await Chat.findOne({
      users: { $all: [req.user._id, userId] }
    });

    if (existingChat) {
      return res.status(200).send(existingChat);
    } else {
      const chatData = {
        chatName: "sender",
        users: [req.user._id, userId],
      };
      const createdChat = await Chat.create(chatData);
      const fullChat = await Chat.findOne({ _id: createdChat._id }).populate(
        "users",
        "-password"
      );
      return res.status(200).send(fullChat);
    }
  } catch (error) {
    console.error("Error creating or retrieving chat:", error);
    return res.status(500).send("Server Error");
  }
}

exports.chatData = async (req, res) => {
  try {
    const chats = await Chat.find({ users: { $in: [req.user._id] } })
      .populate({
        path: 'users',
        select: 'name profileImage'
      }).populate({
        path: 'latestMessage'
      })
      .exec();

    res.send(chats);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
}



exports.allMessages = async (req, res) => {
  try {
    const userId = req.user._id; 

    const messages = await Message.find({
      chat: req.params.chatId,
      deletedFor: { $ne: userId } 
    })
      .populate("sender", "name profileImage email")
      .populate("chat");
    res.json(messages);
  } catch (error) {
    res.status(400);
    res.json({ message: error.message });
  }
};




exports.sendMessage = async (req, res) => {
  const { content, chatId } = req.body;
  if (!content && !req.file) {
    return res.status(400).json({ error: 'Content or image is required.' });
  }

  const newMessage = {
    sender: req.user._id,
    content: content || '',
    chat: chatId,
    ImageUrl: req.file ? `/images/${req.file.filename}` : ''
  };

  try {
    let message = await Message.create(newMessage);

    message = await Message.findById(message._id)
      .populate('sender', 'name profileImage')
      .populate({
        path: 'chat',
        populate: {
          path: 'users',
          select: 'name email profileImage',
        },
      })
      .exec();

    await Chat.findByIdAndUpdate(chatId, { latestMessage: message._id });

    res.json(message);
  } catch (error) {
    res.status(400).send(error.message);
  }
};
exports.downloadImg = async (req, res) => {
  try {
    const { imageUrl } = req.params;
    const decodedImageUrl = decodeURIComponent(imageUrl);

    const imagePath = path.join(__dirname, '..',  decodedImageUrl);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Image file not found on server' });
    }


    res.sendFile(imagePath);
  } catch (error) {
    console.error('Error downloading image:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteForMe = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;

  try {
    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (!message.deletedFor.includes(userId)) {
      message.deletedFor.push(userId);
    }

    await message.save();
    res.status(200).json({ message: "Message deleted for you" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}



exports.deleteForEveryone = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { chatId } = req.params;

    const updateResult = await Message.updateMany(
      { _id: { $in: messageId } },
      {
        $set: {
          content: 'This message has been deleted',
          ImageUrl: null,
          chat: chatId,
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      const messages = await Message.find({
        chat: chatId
      })
        .populate("sender", "name profileImage email")
        .populate("chat");
      res.status(200).json({ message: 'Messages updated successfully', allMessage:messages });
    } else {
      res.status(404).json({ error: 'Messages not found' });
    }
  } catch (error) {
    console.error('Error updating messages:', error);
    res.status(500).json({ error: 'Server error' });
  }
};