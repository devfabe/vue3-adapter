
import {
    defineComponent,
    reactive,
    toRaw,
    h as createElement,
    getCurrentInstance,
    onBeforeMount,
    onMounted,
    onBeforeUpdate,
    onUpdated,
    onBeforeUnmount,
    onUnmounted,
    onErrorCaptured,
    nextTick,
} from 'vue'

/* ------------------------------------------------------------------ */
/* 可选基类：帮你把 props / context 存好，不继承也行                    */
/* ------------------------------------------------------------------ */
export class VueComponent {
    constructor(props, ctx) {
        this.props = props
        this.context = ctx
    }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */
function shallowEqual(a, b) {
    if (a === b) {
        return true
    }
    if (!a || !b) {
        return false
    }
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) {
        return false
    }
    for (let i = 0; i < ka.length; i++) {
        const k = ka[i]
        if (a[k] !== b[k] || !Object.prototype.hasOwnProperty.call(b, k)) {
            return false
        }
    }
    return true
}

/* ------------------------------------------------------------------ */
/* 主函数                                                              */
/* ------------------------------------------------------------------ */
export function defineClassComponent(ClassComponent, options = {}) {
    if (typeof ClassComponent !== 'function') {
        throw new TypeError('[defineClassComponent] 第一个参数必须是 class')
    }

    const name = options.name || ClassComponent.displayName || ClassComponent.name || 'AnonymousClassComponent'

    // 可选：接管钩子内抛出的错误，签名 (err, { hook, name, component }) => void
    const onError = typeof options.onError === 'function' ? options.onError : null

    /**
     * 钩子错误统一在这里终结。
     * 缺省打 console.error；传了 options.onError 就交给使用方决定怎么记。
     * onError 自己抛错也必须吞掉，否则又回到「打断 post-flush 队列」的老路。
     */
    function reportHookError(err, hookName, component) {
        if (onError) {
            try {
                onError(err, { hook: hookName, name, component })
                return
            } catch (hookErr) {
                console.error(`[defineClassComponent] 组件「${name}」的 onError 回调自身抛错：`, hookErr)
            }
        }
        console.error(`[defineClassComponent] 组件「${name}」的 ${hookName} 执行出错，已忽略以免打断 Vue 调度队列：`, err)
    }

    const props = options.props ?? ClassComponent.props ?? {}
    const emits = options.emits ?? ClassComponent.emits
    const inheritAttrs = options.inheritAttrs ?? ClassComponent.inheritAttrs ?? true
    const components = options.components ?? ClassComponent.components
    const directives = options.directives ?? ClassComponent.directives

    return defineComponent({
        name,
        props,
        emits,
        inheritAttrs,
        components,
        directives,

        setup(_rawProps, ctx) {
            const internal = getCurrentInstance()
            const vm = internal.proxy

            /* ---------------- 1. 实例化 ---------------- */
            const rawProps = {}
            Object.assign(rawProps, _rawProps, ctx.attrs)
            const instance = new ClassComponent(rawProps, ctx)

            /* ---------------- 2. state ---------------- */
            const initial = (typeof instance.state === 'function' ? instance.state(rawProps) : instance.state) || (typeof instance.data === 'function' ? instance.data() : {}) || {}

            const state = reactive({ ...initial })

            // 用 getter/setter 包一层：this.state = {...} 也能保持响应式
            Object.defineProperty(instance, 'state', {
                get: () => state,
                set: (next) => {
                    if (next && typeof next === 'object') {
                        Object.assign(state, next)
                    }
                },
                enumerable: true,
                configurable: true,
            })

            /* ---------------- 3. 渲染上下文 ---------------- */
            instance.props = rawProps
            instance.context = ctx
            instance.h = createElement

            /* ---------------- 4. proxy：打通 this.$el 等 ---------------- */
            const proxy = new Proxy(instance, {
                get(target, key, receiver) {
                    if (key in target) {
                        return Reflect.get(target, key, receiver)
                    }
                    if (vm && key in vm) {
                        return vm[key]
                    }
                    return undefined
                },
                set(target, key, value, receiver) {
                    return Reflect.set(target, key, value, receiver)
                },
                has(target, key) {
                    return key in target || (vm ? key in vm : false)
                },
            })

            /* ---------------- 5. setState / forceUpdate ---------------- */
            instance.setState = function setState(partial, callback) {
                const patch = typeof partial === 'function' ? partial(state, rawProps) : partial

                if (patch && typeof patch === 'object') {
                    Object.assign(state, patch)
                }
                if (typeof callback === 'function') {
                    nextTick(() => callback.call(proxy))
                }
            }

            instance.forceUpdate = function forceUpdate(callback) {
                vm.$forceUpdate()
                if (typeof callback === 'function') {
                    nextTick(() => callback.call(proxy))
                }
            }

            /* ---------------- 6. 更新快照 ---------------- */
            let prevProps = { ...rawProps }
            let prevState = { ...toRaw(state) }

            /* ---------------- 7. 生命周期桥接 ---------------- */
            // 统一用 .call(proxy) 调用：this 始终是 proxy，
            // 这样 this.$el / this.$refs / this.$nextTick / this.$forceUpdate 等
            // 在所有钩子里行为一致（否则只有 render 里能拿到，钩子里是 undefined）。
            //
            // 再统一经 safeCall 转发：钩子抛错不能向上冒，原因见文件头「生命周期钩子的错误兜底」。
            const safeCall = (hookName, hook, args) => {
                if (typeof hook !== 'function') {
                    return
                }
                try {
                    hook.apply(proxy, args || [])
                } catch (err) {
                    reportHookError(err, hookName, proxy)
                }
            }

            onBeforeMount(() => {
                safeCall('componentWillMount', instance.componentWillMount)
            })

            onMounted(() => {
                safeCall('componentDidMount', instance.componentDidMount)
            })

            onBeforeUpdate(() => {
                if (typeof instance.componentWillReceiveProps !== 'function') {
                    return
                }
                const nextProps = { ...rawProps }
                if (!shallowEqual(nextProps, prevProps)) {
                    safeCall('componentWillReceiveProps', instance.componentWillReceiveProps, [nextProps, prevProps])
                }
            })

            onUpdated(() => {
                try {
                    safeCall('componentDidUpdate', instance.componentDidUpdate, [prevProps, prevState])
                } finally {
                    // 快照必须放 finally：componentDidUpdate 抛错时若停在这里之前，
                    // 下一次回调拿到的 prevProps / prevState 就是过期值。
                    prevProps = { ...rawProps }
                    prevState = { ...toRaw(state) }
                }
            })

            onBeforeUnmount(() => {
                safeCall('componentWillUnmount', instance.componentWillUnmount)
            })

            onUnmounted(() => {
                safeCall('componentDidUnmount', instance.componentDidUnmount)
            })

            onErrorCaptured((err, errorInstance, info) => {
                if (typeof instance.componentDidCatch === 'function') {
                    // componentDidCatch 自己在 handleError 的遍历里同步执行，
                    // 这里抛错同样会冲出 ec 链，必须就地兜住。
                    try {
                        instance.componentDidCatch.call(proxy, err, {
                            vueInstance: errorInstance,
                            info,
                        })
                    } catch (catchErr) {
                        reportHookError(catchErr, 'componentDidCatch', proxy)
                    }
                    return false // 阻止继续向上冒泡
                }
                return undefined
            })

            /* ---------------- 8. 渲染函数 ---------------- */
            return function render() {
                if (typeof instance.render !== 'function') {
                    throw new Error(`[defineClassComponent] 组件「${name}」缺少 render 方法`)
                }
                return instance.render.call(proxy, createElement)
            }
        },
    })
}

export default defineClassComponent
