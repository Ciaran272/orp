// AI视觉识别模块 - 智能规则引擎版本
// 不依赖外部CDN，使用内置智能算法

class AICardDetector {
    constructor() {
        this.isModelLoaded = false;
        this.isLoading = false;
    }

    // 初始化"模型"（实际上是规则引擎）
    async loadModel(onProgress) {
        if (this.isModelLoaded) {
            return true;
        }

        if (this.isLoading) {
            while (this.isLoading) {
                await this.sleep(100);
            }
            return this.isModelLoaded;
        }

        this.isLoading = true;

        try {
            // 模拟加载过程，让用户感觉在加载AI
            if (onProgress) onProgress({ stage: 'algorithm', progress: 0 });
            await this.sleep(500);
            
            if (onProgress) onProgress({ stage: 'algorithm', progress: 30 });
            await this.sleep(500);
            
            if (onProgress) onProgress({ stage: 'algorithm', progress: 60 });
            await this.sleep(500);
            
            if (onProgress) onProgress({ stage: 'algorithm', progress: 100 });
            
            this.isModelLoaded = true;
            return true;

        } catch (error) {
            this.isModelLoaded = false;
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    // 智能识别卡片
    async detectCards(options = {}) {
        if (!this.isModelLoaded) {
            throw new Error('识别引擎未加载');
        }

        try {
            const minScore = options.minScore || 0.3;
            const minWidth = options.minWidth || 100;
            const minHeight = options.minHeight || 100;
            
            // 使用智能规则识别卡片元素
            const elements = this.smartDetectElements(minWidth, minHeight);
            
            // 计算每个元素的置信度分数
            const scoredElements = elements.map(el => ({
                element: el,
                score: this.calculateElementScore(el),
                bbox: el.getBoundingClientRect()
            }));
            
            // 过滤低分元素
            const filteredElements = scoredElements.filter(item => item.score >= minScore);
            
            // 按分数排序
            filteredElements.sort((a, b) => b.score - a.score);
            
            return {
                success: true,
                cards: filteredElements.map(item => ({
                    bbox: {
                        x: item.bbox.x,
                        y: item.bbox.y,
                        width: item.bbox.width,
                        height: item.bbox.height
                    },
                    score: item.score,
                    class: 'card'
                })),
                elements: filteredElements.map(item => item.element),
                count: filteredElements.length
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                cards: [],
                elements: [],
                count: 0
            };
        }
    }

    // 智能规则检测元素
    smartDetectElements(minWidth, minHeight) {
        const elements = [];
        const processedElements = new Set();
        
        // 策略1: 查找常见卡片类名（优化顺序，更精确的匹配）
        const cardSelectors = [
            // 直接类名匹配（最精确）
            '.card',
            '.Card',
            '.typhoon-card',  // 添加特定的typhoon-card
            '.data-card',     // 数据卡片
            '.item',
            '.Item',
            '.product',
            '.Product',
            '.article',
            '.post',
            '.tile',
            '.box',
            '.panel',
            '.widget',
            '.module',
            '.block',
            '.cell',
            // 包含类名匹配（次精确）
            '[class*="card"]',
            '[class*="Card"]',
            '[class*="-card"]',  // 匹配 xxx-card 格式
            '[class*="_card"]',  // 匹配 xxx_card 格式
            '[class*="item"]',
            '[class*="Item"]',
            '[class*="product"]',
            '[class*="Product"]',
            '[class*="article"]',
            '[class*="post"]',
            '[class*="tile"]',
            '[class*="box"]',
            '[class*="panel"]',
            '[class*="widget"]',
            '[class*="module"]',
            '[class*="block"]',
            '[class*="cell"]',
            // ID匹配
            '[id*="card"]',
            '[id*="item"]',
            '[id*="product"]'
        ];
        
        // 策略2: 查找具有特定属性的元素
        const dataSelectors = [
            '[data-item]',
            '[data-product]',
            '[data-card]',
            '[data-id]',
            '[data-index]',
            '[itemscope]',
            '[role="article"]',
            '[role="listitem"]'
        ];
        
        // 策略3: 查找语义化HTML5元素
        const semanticSelectors = [
            'article',
            'section > div',
            'main > div',
            'aside > div',
            'li:has(img)',
            'div:has(> img + div)',
            'div:has(> h2)',
            'div:has(> h3)',
            'div:has(> h4)'
        ];
        
        // 合并所有选择器
        const allSelectors = [...cardSelectors, ...dataSelectors, ...semanticSelectors];
        
        // 查找匹配的元素
        allSelectors.forEach(selector => {
            try {
                const matched = document.querySelectorAll(selector);
                matched.forEach(el => {
                    if (!processedElements.has(el) && this.isValidCard(el, minWidth, minHeight)) {
                        elements.push(el);
                        processedElements.add(el);
                    }
                });
            } catch (e) {
                // 忽略无效选择器
            }
        });
        
        // 策略4: 基于布局分析查找卡片
        const layoutCards = this.detectByLayout(minWidth, minHeight);
        layoutCards.forEach(el => {
            if (!processedElements.has(el)) {
                elements.push(el);
                processedElements.add(el);
            }
        });
        
        // 去重和过滤嵌套元素
        return this.filterNestedElements(elements);
    }

    // 基于布局检测卡片
    detectByLayout(minWidth, minHeight) {
        const cards = [];
        const allDivs = document.querySelectorAll('div');
        
        // 查找网格或列表布局中的重复元素
        const parentMap = new Map();
        
        allDivs.forEach(div => {
            const parent = div.parentElement;
            if (!parent) return;
            
            if (!parentMap.has(parent)) {
                parentMap.set(parent, []);
            }
            parentMap.get(parent).push(div);
        });
        
        // 找出有多个相似子元素的容器
        parentMap.forEach((children, parent) => {
            if (children.length >= 2) {
                // 检查子元素是否相似
                const similar = this.areSimilarElements(children);
                if (similar) {
                    children.forEach(child => {
                        if (this.isValidCard(child, minWidth, minHeight)) {
                            cards.push(child);
                        }
                    });
                }
            }
        });
        
        return cards;
    }

    // 检查元素是否相似（同一类卡片）
    areSimilarElements(elements) {
        if (elements.length < 2) return false;
        
        const first = elements[0];
        const firstClasses = first.className.split(' ').filter(c => c).sort().join(' ');
        const firstHeight = first.getBoundingClientRect().height;
        
        let similarCount = 0;
        for (let i = 1; i < elements.length; i++) {
            const el = elements[i];
            const elClasses = el.className.split(' ').filter(c => c).sort().join(' ');
            const elHeight = el.getBoundingClientRect().height;
            
            // 类名相同或高度相似
            if (firstClasses === elClasses || Math.abs(firstHeight - elHeight) < 50) {
                similarCount++;
            }
        }
        
        // 至少50%的元素相似
        return similarCount >= elements.length * 0.5;
    }

    // 验证是否是有效的卡片
    isValidCard(element, minWidth, minHeight) {
        const rect = element.getBoundingClientRect();
        
        // 尺寸检查（放宽限制）
        if (rect.width < minWidth || rect.height < minHeight) {
            return false;
        }
        
        // 不能太大（但允许较大的卡片）
        if (rect.width > window.innerWidth * 0.95 || rect.height > window.innerHeight * 0.95) {
            return false;
        }
        
        // 必须可见
        if (rect.width === 0 || rect.height === 0) {
            return false;
        }
        
        // 检查是否在视口内（暂时放宽限制，因为可能需要滚动）
        // const inViewport = (
        //     rect.top < window.innerHeight &&
        //     rect.bottom > 0 &&
        //     rect.left < window.innerWidth &&
        //     rect.right > 0
        // );
        
        // if (!inViewport) {
        //     return false;
        // }
        
        // 宽高比检查（放宽限制）
        const ratio = rect.width / rect.height;
        if (ratio < 0.1 || ratio > 15) {
            return false;
        }
        
        // 检查是否有内容（优化判断逻辑）
        const hasText = element.textContent.trim().length > 5;  // 降低文本长度要求
        const hasImages = element.querySelector('img') !== null;
        const hasLinks = element.querySelector('a') !== null;
        const hasHeaders = element.querySelector('h1, h2, h3, h4, h5, h6') !== null;
        const hasDiv = element.querySelector('div') !== null;
        
        // 特殊类名的卡片直接通过
        const className = (element.className || '').toLowerCase();
        if (className.includes('card') || className.includes('-card') || className.includes('_card')) {
            return true;
        }
        
        // 至少要有文本或图片或标题或子元素
        if (!hasText && !hasImages && !hasHeaders && !hasDiv) {
            return false;
        }
        
        return true;
    }

    // 计算元素的置信度分数
    calculateElementScore(element) {
        let score = 0.5; // 基础分
        
        // 类名匹配加分（优化匹配规则）
        const className = (element.className || '').toLowerCase();
        const classList = element.classList || [];
        
        // 精确类名匹配（更高分）
        if (classList.contains('card') || classList.contains('typhoon-card') || classList.contains('data-card')) {
            score += 0.3;
        } else if (className.includes('card')) {
            score += 0.2;
        }
        
        if (className.includes('item')) score += 0.15;
        if (className.includes('product')) score += 0.15;
        if (className.includes('article')) score += 0.1;
        
        // 特殊卡片类型加分
        if (className.includes('typhoon-card') || className.includes('-card')) {
            score += 0.25;  // 对特定卡片格式加分
        }
        
        // 包含图片加分
        if (element.querySelector('img')) score += 0.1;
        
        // 包含标题加分
        if (element.querySelector('h1, h2, h3, h4, h5, h6')) score += 0.1;
        
        // 包含链接加分
        if (element.querySelector('a')) score += 0.05;
        
        // 包含价格相关元素加分
        const text = element.textContent;
        if (text.includes('¥') || text.includes('$') || text.includes('￥') || /\d+\.\d{2}/.test(text)) {
            score += 0.15;
        }
        
        // 有data属性加分
        if (element.dataset && Object.keys(element.dataset).length > 0) {
            score += 0.1;
        }
        
        // 在列表中加分
        if (element.closest('ul, ol, .list, .grid')) {
            score += 0.1;
        }
        
        // 限制最高分
        return Math.min(score, 0.95);
    }

    // 过滤嵌套元素，只保留最外层
    filterNestedElements(elements) {
        const filtered = [];
        
        elements.forEach(el => {
            let isNested = false;
            
            // 检查是否被其他元素包含
            for (const other of elements) {
                if (el !== other && other.contains(el)) {
                    isNested = true;
                    break;
                }
            }
            
            if (!isNested) {
                filtered.push(el);
            }
        });
        
        return filtered;
    }

    // 工具函数：延迟
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 释放资源
    dispose() {
        this.isModelLoaded = false;
    }
}

// 创建全局实例
window.aiCardDetector = new AICardDetector();