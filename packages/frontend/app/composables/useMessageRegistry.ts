import type { Component } from 'vue'

const registry: Record<string, Component> = {}

export function useMessageRegistry() {
  function register(type: string, component: Component) {
    registry[type] = component
  }

  function getComponent(type: string): Component | null {
    return registry[type] ?? null
  }

  return { register, getComponent }
}
