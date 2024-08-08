class LLMChatInterface {
    constructor(config) {
        this.chatMessages = document.getElementById(config.ChatMessagesId);
        this.userInput = document.getElementById(config.UserInputId);
        this.sendButton = document.getElementById(config.SendButtonId);

        this.API_URL = config.API_URL;
        this.X_PORTKEY_API_KEY = config.X_PORTKEY_API_KEY;
        this.X_PORTKEY_VIRTUAL_KEY = config.X_PORTKEY_VIRTUAL_KEY;
        this.X_PORTKEY_CONFIG = config.X_PORTKEY_CONFIG;

        this.conversationHistory = [];
        this.buffer = [];
        this.alreadyWriting = false;
        this.streamEnded = false;
        this.hasStarted = false;
        this.controller = null;
        this.mem = "";
        this.assistantMessageElement = null;

        // Optional callbacks
        this.onStartCallback = config.onStartCallback || (() => {});
        this.onEndCallback = config.onEndCallback || ((finalContent) => {});

        // Bind events
        this.sendButton.addEventListener('click', this.sendMessage.bind(this));
        this.userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    async write() {
        if (this.buffer.length > 0) {
            this.alreadyWriting = true;
            const chunk = this.buffer.shift();
            this.assistantMessageElement.innerHTML += chunk;
            setTimeout(this.write.bind(this), 5); 
        } else {
            if (this.streamEnded) {
                this.onEndCallback(this.assistantMessageElement.innerHTML);
            }
            this.alreadyWriting = false;
        }
    }

    async sendMessage() {
        const userMessage = this.userInput.value.trim();
        if (userMessage === '') return;

        this.addMessage('user', userMessage);
        this.userInput.value = '';

        this.conversationHistory.push({ role: 'user', content: userMessage });
        this.assistantMessageElement = this.addMessage('assistant', ''); 

        this.controller = new AbortController();
        const signal = this.controller.signal;

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'origin': '*',
                    'x-portkey-api-key': this.X_PORTKEY_API_KEY,
                    'x-portkey-virtual-key': this.X_PORTKEY_VIRTUAL_KEY,
                    'x-portkey-config': this.X_PORTKEY_CONFIG
                },
                body: JSON.stringify({
                    messages: this.conversationHistory,
                    stream: true
                }),
                signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            if (!this.hasStarted) {
                this.onStartCallback();
                this.hasStarted = true;
            }

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.trim() !== '');

                if (this.mem !== "") {
                    lines[0] = this.mem + lines[0];
                    this.mem = "";
                }

                for (const line of lines) {
                    const dataContent = line.replace(/^data: /, '').trim();

                    if (dataContent === "[DONE]") {
                        this.streamEnded = true;
                        break;
                    }

                    try {
                        const responseData = JSON.parse(dataContent);
                        if (responseData.choices && responseData.choices[0].delta && responseData.choices[0].delta.content) {
                            const newContent = responseData.choices[0].delta.content;
                            this.buffer.push(newContent);
                        }
                    } catch (ex) {
                        this.mem = dataContent;
                    }
                }

                if (!this.alreadyWriting) {
                    this.write();
                }
            }

        } catch (error) {
            if (signal.aborted) {
                this.assistantMessageElement.innerText = "Request aborted.";
            } else {
                console.error('Error:', error);
                this.addMessage('error', 'An error occurred while fetching the response.');
            }
        } finally {
            this.controller = null;
        }
    }

    addMessage(role, content) {
        const messageElement = document.createElement('div');
        messageElement.className = `llm-interface-message llm-interface-${role}`;
        messageElement.innerHTML = content.replace(/\n/g, '<br>'); 
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        return messageElement;
    }
}
