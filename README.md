# @devfab/vue3-adapter

把 **React 风格的写法**（类组件 / 函数组件 + Hooks）搬到 **Vue 3** 上运行的轻量适配层。

- **零侵入**：底层仍是 `defineComponent` + `reactive` + `h`，产物只有三个 API 入口，没有自己的运行时。
- **类组件**：`state` / `setState` / `forceUpdate` / 生命周期钩子，`this.$el`、`this.$refs`、`this.$nextTick` 照常可用。
- **函数组件**：`useState`、`useRef`、`useMemo`、`useCallback`、`useEffect`、`useReducer`、`useContext`、`useProvide`，带依赖比对与 Hook 顺序校验。
- **错误兜底**：钩子/副作用里抛出的错误会被就地终结，不会打断 Vue 的调度队列、也不会变成未处理的 Promise 拒绝。

---

## 安装

```bash
# pnpm
pnpm add @devfab/vue3-adapter
# npm
npm i @devfab/vue3-adapter
# yarn
yarn add @devfab/vue3-adapter
```

`vue` 需要由宿主工程自行提供（打包时作为**外部依赖**处理，不会打进 `dist`）：

```bash
pnpm add vue@^3
```

> 本项目源码本身不依赖 JSX，但下文示例与日常开发推荐用 JSX 写渲染函数，需要在宿主工程配置 `@vue/babel-plugin-jsx`（见「快速开始」）。

---

## 快速开始

> 下面的示例统一使用 **JSX** 语法，需在宿主工程中开启 `@vue/babel-plugin-jsx`：
>
> ```js
> // babel.config.js
> module.exports = {
>     presets: ['@babel/preset-env'],
>     plugins: ['@vue/babel-plugin-jsx'],
> }
> ```
>
> JSX 里 `class` / `className` 均可，事件用 `onClick` 这类 React 风格命名。Vite 工程则改用 `@vitejs/plugin-vue-jsx`。

### 函数组件 + Hooks

```jsx
import { defineFunctionComponent, useState, useEffect, useRef } from '@devfab/vue3-adapter'

const Counter = defineFunctionComponent(
    ({ step }) => {
        const [count, setCount] = useState(0)
        const timer = useRef(null)

        useEffect(() => {
            timer.current = setInterval(() => setCount((c) => c + step), 1000)
            return () => clearInterval(timer.current) // 卸载 / 依赖变化时清理
        }, [step])

        return (
            <div class="counter">
                <span>count: {count.value}</span>
                <button onClick={() => setCount(count.value + 1)}>+1</button>
            </div>
        )
    },
    { name: 'Counter', props: { step: { type: Number, default: 1 } } }
)

export default Counter
```

`fn(props, ctx, h)` 每次渲染都会被重新执行，Hooks 通过调用**索引**复用上一次的状态；`h` 可省略，用 JSX 就够了。

### 类组件

```jsx
import { defineClassComponent, VueComponent } from '@devfab/vue3-adapter'

class Todo extends VueComponent {
    static props = {
        title: { type: String, default: '' },
    }

    state = { open: false }

    componentDidMount() {
        console.log('已挂载，根元素：', this.$el) // this.$el / this.$refs 均可用
    }

    componentDidUpdate(prevProps, prevState) {
        console.log('更新前状态：', prevState)
    }

    render() {
        return (
            <div class="todo" onClick={() => this.setState({ open: !this.state.open })}>
                <h3>{this.props.title}</h3>
                {this.state.open && <p>内容</p>}
            </div>
        )
    }
}

export default defineClassComponent(Todo, { name: 'Todo' })
```

不继承 `VueComponent` 也可以，基类只是帮忙存好了 `props` / `context`。

---

## API

### defineFunctionComponent(fn, options?)

把函数组件包装成一个 Vue 组件。

| 参数      | 说明                                                 |
| --------- | ---------------------------------------------------- |
| `fn`      | `(props, ctx, h) => VNode \| VNode[]`，每次渲染都执行 |
| `options` | 见下表，缺省时回落到 `fn.props`、`fn.emits` 等静态属性 |

`options` 字段：

| 字段            | 说明                                                     |
| --------------- | -------------------------------------------------------- |
| `name`          | 组件名，缺省依次取 `fn.displayName`、`fn.name`           |
| `props`         | 组件 props 定义                                          |
| `emits`         | 组件 emits 定义                                          |
| `inheritAttrs`  | 是否透传 attrs，默认 `true`                              |
| `components`    | 局部注册的子组件                                         |
| `directives`    | 局部注册的指令                                           |
| `onError`       | `(err, { hook, name, component }) => void`，见「错误处理」 |

`props` 会把 `props` 与 `ctx.attrs` 合并后传入，且**每次渲染都是新对象**，可安全用于 JSX。

### Hooks

| Hook                | 签名                                    | 返回值                     | 说明                                                  |
| ------------------- | --------------------------------------- | -------------------------- | ----------------------------------------------------- |
| `useState`          | `(initial)`                             | `[ref, setState]`          | `initial` 可为值或惰性函数；`setState` 支持函数式更新 |
| `useRef`            | `(initial)`                             | `{ current }`              | 稳定引用，变更不触发渲染                              |
| `useMemo`           | `(factory, deps)`                       | 缓存值                     | `deps` 用 `Object.is` 逐项比对                        |
| `useCallback`       | `(fn, deps)`                            | 缓存函数                   | 独立 slot，与 `useMemo` 混用会被顺序校验发现          |
| `useEffect`         | `(effect, deps)`                        | `void`                     | 返回值作为 cleanup；在 `nextTick`（DOM 更新后）执行   |
| `useLayoutEffect`   | `(effect, deps)`                        | `void`                     | Vue 的 DOM 更新是同步的，此处等价于 `useEffect`       |
| `useReducer`        | `(reducer, initialArg, init?)`          | `[ref, dispatch]`          | `reducer` 每次渲染更新，无闭包陷阱                    |
| `useContext`        | `(key, defaultValue?)`                  | 注入值                     | 基于 `inject`，**只在首次渲染取值**                   |
| `useProvide`        | `(key, value)`                          | `void`                     | 基于 `provide`，**只在首次渲染调用**                  |

> `useState` / `useReducer` 返回的是 Vue 的 `ref`，不是普通值：在 JSX 与渲染函数中取值需写 `count.value`，赋值/更新请用返回的 `setState` / `dispatch`。

**Hooks 规则**（与 React 一致）：

- 只能在 `defineFunctionComponent` 的渲染过程中调用，写在事件回调、`setTimeout` 或组件外部会直接抛错；
- 必须**无条件、按固定顺序**调用，不能放在 `if` / `for` / 提前 `return` 之后。

开发环境下会做两项校验：本次调用数量与上次不一致时报「Hook 数量错误」，同一索引位置换了 Hook 类型时报「Hook 顺序错误」；生产环境静默跳过。

### defineClassComponent(ClassComponent, options?)

把类组件包装成一个 Vue 组件。`options` 与 `defineFunctionComponent` 相同，另有以下约定：

**实例字段 / 方法**

| 成员                                 | 说明                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `state`                              | 自动包成 `reactive`，可用 `this.state = {...}` 整体合并（保持响应式）  |
| `state()` / `data()`                 | 二选一提供初始状态，`state` 函数会收到 `props`                          |
| `setState(partial \| fn, callback?)` | 浅合并更新，`callback` 在 `nextTick` 后以组件实例为 `this` 执行        |
| `forceUpdate(callback?)`             | 触发 `$forceUpdate`                                                    |
| `render(h)`                          | **必需**，缺失会抛出明确错误；`h` 作为参数传入，用 JSX 时可忽略        |
| `props` / `context` / `h`            | 渲染上下文，构造后可覆盖                                                |

`this` 在所有钩子里都是同一个 proxy：既访问类实例成员，也会回落到 Vue 实例，因此 `this.$el`、`this.$refs`、`this.$nextTick`、`this.$forceUpdate` 行为一致。

**生命周期映射**

| 类组件钩子                                        | 映射到 Vue 3                | 备注                                             |
| ------------------------------------------------- | --------------------------- | ------------------------------------------------ |
| `componentWillMount()`                            | `onBeforeMount`             |                                                  |
| `componentDidMount()`                             | `onMounted`                 |                                                  |
| `componentWillReceiveProps(nextProps, prevProps)` | `onBeforeUpdate`            | 仅 props 浅比较有变化时触发                      |
| `componentDidUpdate(prevProps, prevState)`        | `onUpdated`                 | 快照在 `finally` 中推进，钩子抛错也不会导致错位  |
| `componentWillUnmount()`                          | `onBeforeUnmount`           |                                                  |
| `componentDidUnmount()`                           | `onUnmounted`               |                                                  |
| `componentDidCatch(err, { vueInstance, info })`   | `onErrorCaptured`           | 返回 `false`，阻止错误继续向上冒泡               |

### VueComponent

可选基类，仅做一件事：在构造函数里保存 `props` 与 `context`。

```jsx
class MyComp extends VueComponent {
    render() {
        return <div>{this.props.text}</div>
    }
}
```

---

## 错误处理

两个入口都支持 `options.onError`，签名一致，宿主可以只写一份上报逻辑：

```js
const onError = (err, { hook, name, component }) => {
    report(err, { hook, component: name })
}

defineClassComponent(MyClass, { onError })
defineFunctionComponent(MyFn, { onError })
```

行为约定：

- 钩子（`componentDidMount` 等）、`useEffect` 及其 cleanup 抛出的错误会被就地捕获，**默认 `console.error`**，不会冒泡打断 Vue 的 post-flush 调度队列，也不会变成 `Uncaught (in promise)`。
- `onError` 自身抛错也会被吞掉，避免上报逻辑引出新的未捕获异常。
- `useEffect` 失败后**不回退 deps**，不会每次渲染重跑同一个必然失败的效果；如需重试，请在 `onError` 中自行触发一次更新。
- 类组件 `render` 缺失、Hook 在渲染过程外调用等**使用错误仍然直接抛出**，不会被吞掉。

---

## 构建与发布

```bash
pnpm install

pnpm dev            # 开发构建（不压缩）→ dist/
pnpm build          # 生产构建（terser 压缩）→ dist/
pnpm clean          # 清理 dist / lib

```

产物（Rollup 一次构建三份）：

| 文件               | 格式 | 入口字段  | 用途                     |
| ------------------ | ---- | --------- | ------------------------ |
| `dist/index.js`    | CJS  | `main`    | Node / 旧构建工具        |
| `dist/index.esm.js`| ESM  | `module`  | Webpack、Vite 等现代构建 |
| `dist/index.umd.js`| UMD  | `umd`     | 浏览器 `<script>` 直接引入，全局名 `devfab-vue3-adapter` |

`vue` 不参与打包；`process.env.NODE_ENV` 在构建时被静态替换，因此生产产物里的 dev 校验会被摇掉。

发布包只包含 `LICENSE`、`README.md`、`dist`。

---

## License

ISC

##Author

2030034838@qq.com
