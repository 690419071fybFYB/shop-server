const bcrypt = require('bcryptjs');

module.exports = class extends think.Service {
  getRounds() {
    const security = think.config('security') || {};
    let rounds = Number(security.adminPasswordHashRounds || 10);
    if (Number.isNaN(rounds) || rounds < 8) {
      rounds = 10;
    }
    if (rounds > 14) {
      rounds = 14;
    }
    return rounds;
  }

  isBcryptHash(hash) {
    const value = String(hash || '');
    return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
  }

  async hashPassword(password) {
    return bcrypt.hash(String(password || ''), this.getRounds());
  }

  verifyLegacyMd5(password, hash, salt) {
    const raw = String(password || '');
    const dbHash = String(hash || '');
    const dbSalt = String(salt || '');
    return think.md5(raw + dbSalt) === dbHash;
  }

  async verifyPassword(password, hash, salt) {
    const dbHash = String(hash || '');
    if (!dbHash) {
      return false;
    }
    if (this.isBcryptHash(dbHash)) {
      return bcrypt.compare(String(password || ''), dbHash);
    }
    return this.verifyLegacyMd5(password, dbHash, salt);
  }

  shouldUpgradeHash(hash) {
    return !this.isBcryptHash(hash);
  }
};
