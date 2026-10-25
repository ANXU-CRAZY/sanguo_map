from __future__ import annotations

from collections import deque


class AhoCorasick:
    """Small multi-pattern exact matcher; returns overlapping source spans."""

    def __init__(self, patterns: dict[str, object]):
        self.goto = [{}]
        self.fail = [0]
        self.output = [[]]
        for pattern, value in patterns.items():
            state = 0
            for char in pattern:
                child = self.goto[state].get(char)
                if child is None:
                    child = self._new_state()
                    self.goto[state][char] = child
                state = child
            self.output[state].append((pattern, value))
        queue = deque()
        for state in self.goto[0].values():
            queue.append(state)
        while queue:
            state = queue.popleft()
            for char, child in self.goto[state].items():
                queue.append(child)
                fallback = self.fail[state]
                while fallback and char not in self.goto[fallback]:
                    fallback = self.fail[fallback]
                self.fail[child] = self.goto[fallback].get(char, 0)
                self.output[child].extend(self.output[self.fail[child]])

    def _new_state(self):
        self.goto.append({})
        self.fail.append(0)
        self.output.append([])
        return len(self.goto) - 1

    def finditer(self, text: str):
        state = 0
        for index, char in enumerate(text):
            while state and char not in self.goto[state]:
                state = self.fail[state]
            state = self.goto[state].get(char, 0)
            for pattern, value in self.output[state]:
                yield index - len(pattern) + 1, index + 1, pattern, value
