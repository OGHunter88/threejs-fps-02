// The round: freeze, live, over, and the money between rounds. Vanguard
// (the player's team) defends the two sites; Raiders attack and plant. A round
// ends on elimination, on the bomb, or on the clock. The first team to five
// rounds takes the match.
export const FREEZE_TIME = 12;
export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const WIN_ROUNDS = 5;

const WIN_BONUS = 3250;
const LOSS_BONUS = 1900;
const LOSS_STREAK_BONUS = 500;
const KILL_REWARD = 300;
const START_MONEY = 800;

export function createRounds(game) {
  const round = {
    number: 1,
    phase: 'freeze',
    timer: FREEZE_TIME,
    score: { vanguard: 0, raider: 0 },
    lossStreak: { vanguard: 0, raider: 0 },
    winner: null,
    reason: '',
    matchWinner: null,
  };

  function startRound(number) {
    round.number = number;
    round.phase = 'freeze';
    round.timer = FREEZE_TIME;
    round.winner = null;
    round.reason = '';
    game.resetRound();
  }

  function startMatch() {
    round.score.vanguard = 0;
    round.score.raider = 0;
    round.lossStreak.vanguard = 0;
    round.lossStreak.raider = 0;
    round.matchWinner = null;
    game.player.money = START_MONEY;
    startRound(1);
  }

  function awardMoney(winner) {
    const loser = winner === 'vanguard' ? 'raider' : 'vanguard';
    round.lossStreak[winner] = 0;
    round.lossStreak[loser] += 1;
    const streak = Math.min(round.lossStreak[loser], 2);
    if (game.player.team === winner) {
      game.player.money += WIN_BONUS;
    } else {
      game.player.money += LOSS_BONUS + streak * LOSS_STREAK_BONUS;
    }
  }

  function endRound(winner, reason) {
    if (round.phase === 'over' || round.phase === 'matchover') return;
    round.phase = 'over';
    round.timer = 4;
    round.winner = winner;
    round.reason = reason;
    round.score[winner] += 1;
    awardMoney(winner);
    game.onRoundEnd(winner, reason);
    if (round.score[winner] >= WIN_ROUNDS) {
      round.matchWinner = winner;
    }
  }

  function step(dt) {
    if (round.phase === 'matchover') return;
    round.timer -= dt;
    if (round.phase === 'freeze') {
      if (round.timer <= 0) {
        round.phase = 'live';
        round.timer = ROUND_TIME;
        game.onRoundStart();
      }
      return;
    }
    if (round.phase === 'live') {
      // Elimination ends the round, unless the bomb is already planted.
      const vanguardAlive = game.aliveCount('vanguard');
      const raiderAlive = game.aliveCount('raider');
      if (raiderAlive === 0 && game.bomb.state !== 'planted') {
        endRound('vanguard', 'Raiders eliminated');
        return;
      }
      if (vanguardAlive === 0 && game.bomb.state !== 'planted') {
        endRound('raider', 'Vanguard eliminated');
        return;
      }
      if (vanguardAlive === 0 && game.bomb.state === 'planted') {
        // The last defender fell with the bomb ticking: the round is the bomb's.
        return;
      }
      if (game.bomb.state === 'planted') {
        game.bomb.timer -= dt;
        if (game.bomb.timer <= 0) {
          game.explodeBomb();
          endRound('raider', 'Bomb detonated');
          return;
        }
      }
      if (round.timer <= 0) {
        if (game.bomb.state === 'planted') return; // the bomb timer decides it
        endRound('vanguard', 'Time expired — sites held');
      }
      return;
    }
    if (round.phase === 'over') {
      if (round.timer <= 0) {
        if (round.matchWinner) {
          round.phase = 'matchover';
          game.onMatchEnd(round.matchWinner);
        } else {
          startRound(round.number + 1);
        }
      }
    }
  }

  return {
    state: round,
    startMatch,
    startRound,
    endRound,
    step,
    killReward() {
      game.player.money += KILL_REWARD;
    },
  };
}
