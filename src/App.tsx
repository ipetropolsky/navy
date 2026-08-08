import styles from './App.module.less';

export default function App() {
    return (
        <div className={styles.main}>
            Hello, <span className={styles.accent}>World!</span>
        </div>
    );
}
