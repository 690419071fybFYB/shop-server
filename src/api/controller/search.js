const Base = require('./base.js');
module.exports = class extends Base {
    normalizeKeyword(rawKeyword) {
        return String(rawKeyword || '').trim().slice(0, 50);
    }

    getSearchKeywordLimit() {
        const configured = Number(process.env.SEARCH_KEYWORD_SUGGEST_LIMIT || 10);
        if (!Number.isFinite(configured)) {
            return 10;
        }
        return Math.max(1, Math.floor(configured));
    }

    dedupeKeywordList(keywordList = [], limit = 10) {
        const normalizedLimit = Math.max(1, Number(limit || 10));
        const seen = new Set();
        const result = [];
        for (const item of keywordList) {
            const keyword = this.normalizeKeyword(item);
            if (keyword === '' || seen.has(keyword)) {
                continue;
            }
            seen.add(keyword);
            result.push(keyword);
            if (result.length >= normalizedLimit) {
                break;
            }
        }
        return result;
    }

    async fetchConfiguredDefaultKeyword() {
        return this.model('keywords').where({
            is_default: 1
        }).limit(1).find();
    }

    async fetchConfiguredHotKeywordRows(limit = 10) {
        return this.model('keywords').where({
            is_hot: 1
        }).field('keyword,is_hot').order('sort_order ASC,id DESC').limit(limit).select();
    }

    async fetchHistoryHotKeywordRows(limit = 10) {
        return this.model('search_history').where({
            keyword: ['!=', '']
        }).field('keyword,COUNT(1) AS cnt,MAX(add_time) AS latest_time').group('keyword').order('cnt DESC,latest_time DESC').limit(limit).select();
    }

    async fetchHelperHistoryKeywordRows(keywordPrefix, limit = 10) {
        return this.model('search_history').where({
            keyword: ['like', `${keywordPrefix}%`]
        }).field('keyword,COUNT(1) AS cnt,MAX(add_time) AS latest_time').group('keyword').order('cnt DESC,latest_time DESC').limit(limit).select();
    }

    async fetchUserHistoryKeywords(userId, limit = 10) {
        return this.model('search_history').distinct('keyword').where({
            user_id: userId
        }).limit(limit).getField('keyword');
    }

    buildHotKeywordList(configRows = [], historyRows = [], limit = 10) {
        const normalizedLimit = Math.max(1, Number(limit || 10));
        const configKeywords = (Array.isArray(configRows) ? configRows : []).map(item => item && item.keyword);
        const historyKeywords = (Array.isArray(historyRows) ? historyRows : []).map(item => item && item.keyword);
        const mergedKeywords = this.dedupeKeywordList([...configKeywords, ...historyKeywords], normalizedLimit);
        const configMap = new Map();
        for (const row of (Array.isArray(configRows) ? configRows : [])) {
            const keyword = this.normalizeKeyword(row && row.keyword);
            if (keyword !== '' && !configMap.has(keyword)) {
                configMap.set(keyword, row);
            }
        }
        return mergedKeywords.map((keyword) => {
            const configRow = configMap.get(keyword);
            if (configRow) {
                return {
                    keyword: keyword,
                    is_hot: Number(configRow.is_hot || 1)
                };
            }
            return {
                keyword: keyword,
                is_hot: 1
            };
        });
    }

    async indexAction() {
        // 取出输入框默认的关键词
		let userId = this.getLoginUserId();;
        const keywordLimit = this.getSearchKeywordLimit();
        const defaultKeyword = await this.fetchConfiguredDefaultKeyword();
        const configuredHotRows = await this.fetchConfiguredHotKeywordRows(keywordLimit);
        const historyHotRows = await this.fetchHistoryHotKeywordRows(keywordLimit);
        const hotKeywordList = this.buildHotKeywordList(configuredHotRows, historyHotRows, keywordLimit);
        const historyKeywordList = await this.fetchUserHistoryKeywords(userId, keywordLimit);
        const effectiveDefaultKeyword = think.isEmpty(defaultKeyword) && hotKeywordList.length > 0 ? hotKeywordList[0] : defaultKeyword;
        return this.success({
            defaultKeyword: effectiveDefaultKeyword,
            historyKeywordList: historyKeywordList,
            hotKeywordList: hotKeywordList
        });
    }
    async helperAction() {
        const keyword = this.normalizeKeyword(this.get('keyword'));
        if (keyword === '') {
            return this.success([]);
        }
        const keywordLimit = this.getSearchKeywordLimit();
        const configRows = await this.model('keywords').where({
            keyword: ['like', `${keyword}%`]
        }).field('keyword').order('sort_order ASC,id DESC').limit(keywordLimit).select();
        const historyRows = await this.fetchHelperHistoryKeywordRows(keyword, keywordLimit);
        const keywords = this.dedupeKeywordList([
            ...(Array.isArray(configRows) ? configRows.map(item => item && item.keyword) : []),
            ...(Array.isArray(historyRows) ? historyRows.map(item => item && item.keyword) : [])
        ], keywordLimit);
        return this.success(keywords);
    }
    async clearHistoryAction() {
		let userId = this.getLoginUserId();;
        await this.model('search_history').where({
            user_id: userId
        }).delete();
        return this.success();
    }
};
