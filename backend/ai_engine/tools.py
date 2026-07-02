import yfinance as yf
from duckduckgo_search import DDGS
import logging
import re

logger = logging.getLogger(__name__)

def fetch_stock_info(symbol: str) -> str:
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        price = info.get('currentPrice') or info.get('regularMarketPrice')
        currency = info.get('currency', 'USD')
        name = info.get('shortName', symbol)
        if not price:
            return ""
        return f"[Live Stock Data: {name} ({symbol}) is currently priced at {price} {currency}.]"
    except Exception as e:
        logger.error(f"Error fetching stock info for {symbol}: {e}")
        return ""

def fetch_web_search(query: str, max_results: int = 3) -> str:
    try:
        # Use a context manager with a short 5-second timeout to prevent blocking
        with DDGS(timeout=5) as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
            if not results:
                return ""
            
            snippets = [f"- {res['title']}: {res['body']}" for res in results]
            combined = "\n".join(snippets)
            return f"[Real-time Web Results for '{query}']:\n{combined}\n"
    except Exception as e:
        logger.error(f"Error fetching web search for {query}: {e}")
        return ""

def determine_context(user_message: str) -> str:
    """Analyzes the user's message and fetches live context if applicable."""
    user_message_lower = user_message.lower()
    context_chunks = []

    # Extremely Fast Bypass: Prevent heavy web searches for simple math or casual chatter
    if re.search(r'\d+\s*[\+\-\*\/\=]\s*\d+', user_message) or len(user_message.split()) <= 2:
        return ""
    
    casual_greetings = ["hi", "hello", "hey", "who are you", "what is your name", "how are you"]
    if any(user_message_lower.startswith(g) for g in casual_greetings) and len(user_message_lower) < 20:
        return ""

    # Simple stock ticker extraction (e.g., "AAPL stock", "price of TSLA")
    stock_match = re.search(r'\b([A-Z]{1,5})\b(?=.*\b(stock|price|shares)\b)|(?<=\b(?:stock|price) of\b )([A-Z]{1,5})', user_message, re.IGNORECASE)
    if stock_match:
        symbol = stock_match.group(1) or stock_match.group(3)
        if symbol:
            stock_data = fetch_stock_info(symbol.upper())
            if stock_data:
                context_chunks.append(stock_data)

    # Weather check
    if "weather" in user_message_lower:
        weather_data = fetch_web_search(user_message, max_results=2)
        if weather_data:
            context_chunks.append(weather_data)

    # General knowledge / Current events / Graduate level questions
    # If the message is long or seems factual, we do a quick web search to augment gemma:2b
    elif len(user_message.split()) > 3 and any(w in user_message_lower for w in ["who", "what", "where", "when", "why", "how", "explain", "latest", "news"]):
        web_data = fetch_web_search(user_message, max_results=3)
        if web_data:
            context_chunks.append(web_data)

    if context_chunks:
        return "\n\n".join(context_chunks)
    
    return ""
