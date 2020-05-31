const Game = require('./../../Game')
const options = require('./../../../config/options')
const metadata = require('./../metadata.json')
const { Collection } = require('./../../../discord_mod')
const { decrypt } = require('./../../../util/cryptography')
const fs = require('fs')

let questionList
decrypt(process.env.PASS_KEY, fs.readFileSync('./games/Survey Says/assets/data.enc', 'utf8'))
.then(data => questionList = JSON.parse(data))

module.exports = class SurveySays extends Game {
    constructor(msg, settings) {
        super(msg, settings)
        
        this.metadata = metadata

        this.gameOptions = [
            {
                friendlyName: 'Timer',
                type: 'free',
                default: 60,
                filter: m => !isNaN(parseInt(m.content)) && (parseInt(m.content) <= 300) && (parseInt(m.content) >= 30),
                note: 'Enter a value in seconds for the countdown timer, between 30 and 300 seconds.'
            },
            {
                friendlyName: 'Points to Win',
                type: 'free',
                default: 5,
                filter: m => !isNaN(parseInt(m.content)) && (parseInt(m.content) <= 12) && (parseInt(m.content) >= 2),
                note: 'Enter how many points a player needs to win, between 2 and 12 points.'
            }
        ]

        this.defaultPlayer = {
            score: 0
        }

        this.question, this.questionList = [...questionList]

        this.guesser, this.guesserIndex = 0
    }

    select(arr) {
        let index = Math.floor(Math.random() * arr.length)
        arr.splice(index, 1)
        return arr[index]
    }

    async sleep(ms) {
        return new Promise(res => setTimeout(res, ms))
    }

    /**
     * The play method, which begins the game and continues until a winner is found.
     */
    async play() {
        while(!this.hasWinner() && !this.ending) {
            // Pick random question
            this.question = this.select(this.questionList)

            let guess = await this.awaitGuesserResponse().catch(console.error)
            let submitted = await this.awaitPlayerResponse().catch(console.error)
            await this.sleep(3000)
            await this.awardPoints(guess, submitted)
        }
        this.end(this.getWinners, this.getEndPhrase())
    }

    /**
     * Adjusts the settings from user-friendly values to game-friendly values
     */
    async gameInit() {
        this.options['Timer'] = parseInt(this.options['Timer']) * 1000
    }

    async awaitGuesserResponse() {
        // Select a new guesser
        this.guesser = this.players.array()[this.guesserIndex++ % this.players.size]
        const filter = m => {
            if(isNaN(m.content) || m.author.id != this.guesser.user.id) return false
            let number = parseInt(m.content)
            return number >= 0 && number <= 100
        }

        // Notify players
        await this.channel.sendMsgEmbed(`The current guesser is ${this.guesser.user}!\n\nYour question is: **${this.question.question}**`)

        // Await response
        let collected = await this.channel.awaitMessages(filter, {max: 1, time: this.options['Timer']})
        .catch(err => {
            console.error(err)
            this.msg.channel.sendMsgEmbed('An error occurred.', 'Error!', options.colors.error)
        })
        return collected ? collected.first() : false
    }

    async awaitPlayerResponse() {
        // Send submission list
        let submitted = new Collection()
        let submissionList = await this.channel.send(this.renderSubmissionList(submitted))
        // Create message listener on channel
        const filter = m => (m.content.toLowerCase() == 'more' || m.content.toLowerCase() == 'less') && this.players.has(m.author.id) && !submitted.has(m.author.id) && m.author.id !== this.guesser.user.id

        return new Promise((resolve, reject) => {
            const collector = this.channel.createMessageCollector(filter, {max: this.players.size - 1, time: this.options['Timer']})

            collector.on('collect', m => {
                if(this.ending) return
                m.delete()
                // Update submitted list
                submitted.set(m.author.id, m.content.toLowerCase())
                // Update submission message
                submissionList.edit(this.renderSubmissionList(submitted))
            })
            // Resolve listener once collector ends
            collector.on('end', collected => {
                if(this.ending) {
                    resolve(false)
                    return
                }
                this.channel.sendMsgEmbed('Drumroll please...')
                resolve(submitted)
            })
        })
    }

    async awardPoints(guess, submitted) {
        let answer = guess < this.question.value ? 'more' : 'less'
        for(let [id, response] of submitted) {
            if(response == answer) this.players.get(id).score++
        }
        await this.channel.send({
            embed: {
                description: this.renderLeaderboard(),
                color: options.colors.info,
                image: 'attachment://image.png'
            },
            files: [{
               attachment: `games/Survey Says/assets/${answer}.png`,
               name: 'image.png'
            }]
        })
    }

    renderLeaderboard() {
        let submissionList = ''
        this.players.forEach((player, id) => {
            submissionList += `**${player.user}**: ${player.score} points\n`
        })
        return submissionList + `First to ${this.options['Points to Win']} points wins!`

    }

    renderSubmissionList(submitted) {
        let submissionList = ''
        const icons = {
            more: '🔺',
            less: '🔻',
            none: '⬜️'
        }
        this.players.forEach((player, id) => {
            if(id == this.guesser.user.id) return
            submissionList += `${icons[submitted.get(id) || 'none']} **${player.user}**\n`
        })
        return {
            embed: {
                description: submissionList + 'Type `more` if you thing the actual number is higher, or `less` if you think that it is lower.',
                color: options.colors.info,
            }
        }
    }

    /**
     * Returns true if the game has a winner
     * @returns {Array<String>} true if there is a winner, or multiple winners
     */
    hasWinner() {
        let winners = []
        for(let i = 0; i < this.players.size; i++) {
            let player = this.players.array()
            if(player.score >= this.options['Points to Win']) {
                winners.push(player.user.id)
            }
        }
        return winners.length > 0
    }

    getEndPhrase() {
        let winners = []
        for(let i = 0; i < this.players.size; i++) {
            let player = this.players.array()
            if(player.score >= this.options['Points to Win']) {
                winners.push(player.user)
            }
        }
        return `The winner${winners.length > 1 ? 's are' : ' is'} ${winners.join(', ')}! To play games with the community, [join our server](${options.serverInvite})!`

    }

}
