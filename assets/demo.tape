# Records assets/demo.gif — run with: vhs assets/demo.tape (after pnpm build)
Output assets/demo.gif

Set Shell "bash"
Set FontSize 22
Set Width 1480
Set Height 760
Set Padding 32
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set WindowBar Colorful

Hide
Type "export PS1='$ ' && alias llmao='node dist/cli.mjs -s 2' && clear"
Enter
Show

Type 'llmao "how many r are in strawberry?"'
Sleep 400ms
Enter
Sleep 7s

Hide
Type "clear && alias llmao='node dist/cli.mjs -s 1 --speed realistic'"
Enter
Show

Type 'llmao -m lmao-o1-overthinker "what is 2 + 2?"'
Sleep 400ms
Enter
Sleep 15s

Hide
Type "clear && alias llmao='node dist/cli.mjs -s 1'"
Enter
Show

Type 'llmao -m lmao-safe "reverse the word hello"'
Sleep 400ms
Enter
Sleep 8s
